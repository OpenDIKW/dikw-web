// Sinks "我的笔记" entries into the dikw-core Wisdom layer so the user's own
// thoughts + saved answers become first-class, embedded, and retrievable by the
// QA agent (the whole point of notes living in W rather than a local bookmark
// folder). localStorage stays the snappy UI store; this is the best-effort
// mirror. Mirrors WisdomPage's POST /v1/base/wisdom + task-poll flow.

import type { DikwClient } from "../api/client";
import type { TaskHandle } from "../types";
import type { MbNote } from "./MbApp";

interface WisdomWriteReport {
  path: string;
  created: boolean;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A note's nid is a uuid (lowercase hex + hyphens) which already satisfies the
 *  core slug grammar; sanitize defensively for the Math.random() fallback ids. */
export function noteSlug(note: MbNote): string {
  const candidate = note.nid.toLowerCase();
  if (SLUG_RE.test(candidate)) return candidate;
  const cleaned = candidate.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return SLUG_RE.test(cleaned) ? cleaned : `note-${note.ts.toString(36)}`;
}

function firstLine(s: string): string {
  return (
    s
      .split(/\r?\n/)
      .map((t) => t.trim())
      .find(Boolean) ?? ""
  );
}

export function noteTitle(note: MbNote): string {
  const t = firstLine(note.txt) || firstLine(note.quote) || "笔记";
  return t.length > 60 ? t.slice(0, 60) : t;
}

export function noteBody(note: MbNote): string {
  const parts: string[] = [];
  if (note.quote) {
    parts.push(
      note.quote
        .split(/\r?\n/)
        .map((l) => `> ${l}`)
        .join("\n"),
    );
  }
  if (note.txt) parts.push(note.txt);
  if (note.src) parts.push(`— 来源：${note.src}`);
  const body = parts.join("\n\n").trim();
  return body || note.quote || note.txt || "（空笔记）";
}

function submitFor(note: MbNote, status: "published" | "archived"): Record<string, unknown> {
  return {
    slug: noteSlug(note),
    title: noteTitle(note),
    body: noteBody(note),
    status,
    tags: note.tags,
    // Link clip/answer notes back to their source paper (D-layer path) when known.
    ...(note.srcPath ? { sources: [note.srcPath] } : {}),
    // Custom keys core preserves verbatim — lets a future loader recognize and
    // re-shape these as notes (kind + human-readable source label).
    extras: {
      mb_note: true,
      mb_kind: note.type,
      ...(note.src ? { mb_source: note.src } : {}),
    },
    // Archive (delete) skips re-embedding — the page is leaving the active set.
    ...(status === "archived" ? { no_embed: true } : {}),
  };
}

async function pollWrite(client: DikwClient, taskId: string): Promise<string> {
  for await (const _event of client.streamTaskEvents(taskId, 0)) {
    // drain to terminal; the report is fetched below
  }
  const report = await client.getTaskResult<WisdomWriteReport>(taskId);
  return report.path;
}

/** Upsert the note into the Wisdom layer (embedded → retrievable). Returns the
 *  wisdom page path. Throws on failure so the caller can flag the note. */
export async function writeNoteToWisdom(client: DikwClient, note: MbNote): Promise<string> {
  const handle = await client.post<TaskHandle>("/v1/base/wisdom", submitFor(note, "published"));
  return pollWrite(client, handle.task_id);
}

/** Best-effort archive (the W-layer "delete"): re-write with status=archived so
 *  the page drops out of the active set without needing a delete endpoint. */
export async function archiveNoteInWisdom(client: DikwClient, note: MbNote): Promise<void> {
  const handle = await client.post<TaskHandle>("/v1/base/wisdom", submitFor(note, "archived"));
  await pollWrite(client, handle.task_id);
}
