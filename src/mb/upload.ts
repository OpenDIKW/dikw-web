// Upload orchestration for the focused UI: one paper File → markdown (via
// MinerU for PDF/Office, or read directly for .md) → /v1/import bundle →
// ingest → synth. Reuses the proven dikw-web utilities so the wire shapes
// (manifest, package_sha256, kebab normalization) stay identical to ImportPage.

import type { DikwClient } from "../api/client";
import {
  convertSource,
  convertedToFiles,
  MineruConvertError,
  MINERU_EXTENSIONS,
  type ConvertCache,
} from "../utils/mineru-convert";
import { buildImportBundle, lowerExt } from "../utils/import-bundle";
import { getMarkdownTitle, parseMarkdownDocument } from "../utils/markdown";
import { splitMarkdownBlocks } from "../utils/markdown-blocks";
import { isEnglishBody } from "../utils/lang";
import { translateBlocks, type TranslateCache } from "../utils/translate";
import type { PageReadResult } from "../types";

export type UploadStage =
  | "converting"
  | "uploading"
  | "indexing"
  | "analyzing"
  | "translating"
  | "done";

export interface UploadProgress {
  stage: UploadStage;
  /** Coarse 0–100 used to drive the library progress bar. */
  pct: number;
}

export interface UploadResult {
  /** sources/<kebab>/<kebab>.md of the imported paper, for auto-select. Null
   *  when core deduped the bytes (already present) and committed nothing. */
  sourcePath: string | null;
  title: string;
}

// Coarse stage→percent so the progress bar always moves forward through the
// four phases even though each phase's true duration is unknown up front.
const STAGE_PCT: Record<UploadStage, number> = {
  converting: 25,
  uploading: 45,
  indexing: 65,
  analyzing: 80,
  translating: 82,
  done: 100,
};

export const STAGE_LABEL: Record<UploadStage, string> = {
  converting: "转换中",
  uploading: "入库中",
  indexing: "索引中",
  analyzing: "分析中",
  translating: "翻译中",
  done: "完成",
};

export interface UploadOptions {
  cache?: ConvertCache | null;
  /** When provided, English papers are translated to Chinese at import and the
   *  result is written to this cache, so the reader's 中英对照 opens instantly
   *  instead of translating on first view. Null → skip (translate on demand). */
  translateCache?: TranslateCache | null;
  signal?: AbortSignal;
  onProgress?: (p: UploadProgress) => void;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function uploadPaper(
  client: DikwClient,
  file: File,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const { signal, onProgress } = opts;
  const emit = (stage: UploadStage) => onProgress?.({ stage, pct: STAGE_PCT[stage] });
  const ext = lowerExt(file.name);
  const stem = file.name.replace(/\.[^.]+$/, "");

  let files: File[];
  let markdown: string;
  if (MINERU_EXTENSIONS.has(ext)) {
    emit("converting");
    const converted = await convertSource(file, {
      cache: opts.cache,
      signal,
      originalFilename: file.name,
    });
    files = convertedToFiles(converted);
    markdown = converted.markdown;
  } else if (ext === ".md") {
    files = [file];
    markdown = await file.text();
  } else {
    throw new Error(`不支持的文件类型「${ext || file.name}」。支持 PDF / Office / Markdown。`);
  }

  emit("uploading");
  const bundle = await buildImportBundle(files);
  const res = await client.importBundle(bundle.payload, bundle.manifestJson, signal);
  const committed = new Set(res.committed ?? []);
  const sourcePath = bundle.manifest.packages.find((p) => committed.has(p.id))?.md_path ?? null;

  emit("indexing");
  const ingest = await client.startIngest({}, signal);
  await drainTask(client, ingest.task_id, signal);

  emit("analyzing");
  const synth = await client.startSynth({}, signal);
  await drainTask(client, synth.task_id, signal);

  // English papers: translate now (best-effort) so 中英对照 opens instantly later.
  await maybePretranslate(client, sourcePath, opts);

  emit("done");
  return { sourcePath, title: getMarkdownTitle(markdown) || stem };
}

/** Pre-warm the bilingual translation cache for an English source so the reader's
 *  中英对照 is a cache hit. Replicates the reader's exact block split so the cache
 *  key matches. Best-effort — failures fall back to on-demand translation. */
async function maybePretranslate(
  client: DikwClient,
  sourcePath: string | null,
  opts: UploadOptions,
): Promise<void> {
  const cache = opts.translateCache;
  if (!cache || !sourcePath) return;
  try {
    const page = await client.get<PageReadResult>(`/v1/base/pages/${encodePath(sourcePath)}`, {
      signal: opts.signal,
    });
    const body = parseMarkdownDocument(page.body, { stripDuplicateTitle: false }).body;
    if (!isEnglishBody(body)) return;
    const textBlocks = splitMarkdownBlocks(body)
      .filter((b) => b.kind === "text")
      .map((b) => b.md);
    if (!textBlocks.length) return;
    const total = textBlocks.length;
    opts.onProgress?.({ stage: "translating", pct: STAGE_PCT.translating });
    await translateBlocks(textBlocks, {
      targetLang: "zh",
      cache,
      signal: opts.signal,
      onProgress: (e) => {
        if (e.phase === "partial") {
          const pct = Math.min(99, 82 + Math.round((e.blocks.length / total) * 17));
          opts.onProgress?.({ stage: "translating", pct });
        }
      },
    });
  } catch {
    // Best-effort: a network/quota failure here just means the reader translates
    // on demand. Don't fail an otherwise-successful import.
  }
}

const NETWORK_MSG = "无法连接服务：请确认 dikw-core 与本应用 (dev server) 都在运行。";

function isNetworkFailure(msg: string): boolean {
  return /failed to fetch|networkerror|load failed|fetch failed|connection/i.test(msg);
}

/** Map an upload error to a concise, actionable Chinese message — most importantly
 *  turning a raw "Failed to fetch" (server down / unreachable) into a clear hint. */
export function friendlyUploadError(e: unknown): string {
  if (e instanceof MineruConvertError) {
    switch (e.code) {
      case "mineru_disabled":
        return "未配置 MinerU，无法转换 PDF / Office 文件。";
      case "mineru_auth":
        return "MinerU 鉴权失败（token 可能已过期）。";
      case "mineru_quota":
        return "MinerU 配额已用尽，请稍后再试。";
      case "mineru_input":
        return "MinerU 无法识别该文件（可能不是有效文档）。";
      case "mineru_timeout":
        return "MinerU 转换超时，请重试。";
      case "aborted":
        return "已取消。";
      default:
        return isNetworkFailure(e.message) ? NETWORK_MSG : `转换失败：${e.message}`;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return isNetworkFailure(msg) ? NETWORK_MSG : msg;
}

/** Drain a task's event stream to terminal, then assert it succeeded. */
async function drainTask(client: DikwClient, taskId: string, signal?: AbortSignal): Promise<void> {
  for await (const _event of client.streamTaskEvents(taskId, 0, signal)) {
    if (signal?.aborted) return;
  }
  if (signal?.aborted) return;
  const final = await client.getTaskFinalEvent(taskId, signal);
  if (final && final.status !== "succeeded") {
    throw new Error(`任务${final.status === "cancelled" ? "已取消" : "失败"}（${taskId}）`);
  }
}
