// E2E for the mineru-backed PDF/Office import flow. The browser drops a
// file → ImportPage partitions it as mineru-bound → POSTs to the sidecar
// → reads back a synthesized tar.gz with markdown + assets → renders the
// bundle preview. We mock /web/mineru with playwright route handlers,
// so the test never hits mineru.net.

import { expect, test } from "./harness";
import { gzipSync } from "node:zlib";
import { mockDikwApi } from "./mockApi";

const TAR_BLOCK = 512;

// ---- USTAR writer (mirrors src/utils/tar.ts buildTar so reader on the
// page side parses our fixtures correctly) ----

function buildTar(entries: Array<{ archivePath: string; data: Uint8Array }>): Uint8Array {
  let total = 0;
  for (const e of entries) {
    total += TAR_BLOCK;
    total += Math.ceil(e.data.length / TAR_BLOCK) * TAR_BLOCK;
  }
  total += TAR_BLOCK * 2;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const e of entries) {
    out.set(ustarHeader(e.archivePath, e.data.length), pos);
    pos += TAR_BLOCK;
    out.set(e.data, pos);
    pos += e.data.length;
    const pad = (TAR_BLOCK - (e.data.length % TAR_BLOCK)) % TAR_BLOCK;
    pos += pad;
  }
  return out;
}

function ustarHeader(archivePath: string, size: number): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK);
  const enc = new TextEncoder();
  const name = enc.encode(archivePath);
  if (name.length > 100) throw new Error(`fixture path too long: ${archivePath}`);
  header.set(name, 0);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30;
  header.set(enc.encode("ustar\0"), 257);
  header[263] = 0x30;
  header[264] = 0x30;
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
  const oct = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) header[148 + i] = oct.charCodeAt(i);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeOctal(view: Uint8Array, off: number, len: number, value: number) {
  const padded = value.toString(8).padStart(len - 1, "0");
  for (let i = 0; i < padded.length; i++) view[off + i] = padded.charCodeAt(i);
  view[off + len - 1] = 0;
}

function makeConvertResponse(
  stem: string,
  markdown: string,
  assets: Array<[string, Uint8Array]>,
): { body: Buffer; contentType: string } {
  const entries = [{ archivePath: `${stem}.md`, data: new TextEncoder().encode(markdown) }];
  for (const [k, v] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    entries.push({ archivePath: k, data: v });
  }
  const tar = buildTar(entries);
  return {
    body: Buffer.from(gzipSync(Buffer.from(tar))),
    contentType: "application/x-tar+gzip",
  };
}

// The convert endpoint now returns a job id (issue #60); the browser polls
// GET /web/mineru/jobs/<id> and fetches GET /web/mineru/jobs/<id>/result. We
// mock those three at the browser-level seam (the mineru.net submit/poll/
// download chain is covered by server/web/http.test.ts unit tests).
//
// `**/web/mineru/convert**` and `**/web/mineru/jobs/**` are disjoint, so route
// registration order doesn't matter; the jobs handler branches on the URL
// suffix (/result, /cancel, or the bare status poll).
async function installMineruJobRoutes(
  page: import("@playwright/test").Page,
  opts:
    | { kind: "success"; stem: string; markdown: string; assets?: Array<[string, Uint8Array]> }
    | { kind: "fail"; error: { code: string; message: string } },
): Promise<{ convertCalls: string[] }> {
  const convertCalls: string[] = [];
  await page.route("**/web/mineru/convert**", async (route) => {
    convertCalls.push(route.request().url());
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "job-1", status: "pending" }),
    });
  });
  await page.route("**/web/mineru/jobs/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/cancel")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (url.endsWith("/result")) {
      if (opts.kind === "success") {
        const fixture = makeConvertResponse(opts.stem, opts.markdown, opts.assets ?? []);
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": fixture.contentType },
          body: fixture.body,
        });
      } else {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "not_ready", message: "not ready" } }),
        });
      }
      return;
    }
    // Bare status poll.
    const body =
      opts.kind === "success"
        ? { jobId: "job-1", status: "succeeded" }
        : { jobId: "job-1", status: "failed", error: opts.error };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { convertCalls };
}

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("dropping a .docx routes through the /web/mineru job flow and shows bundle preview", async ({
  page,
}) => {
  // Override the default disabled health → enabled.
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: true, hasKey: true } });
  });
  const { convertCalls } = await installMineruJobRoutes(page, {
    kind: "success",
    stem: "demo",
    markdown:
      '---\nsource:\n  converter: mineru\n  original_filename: "demo.docx"\n  original_sha256: aaa\n---\n# Demo\n\nBody from mineru.\n',
  });

  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: "demo.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad]),
    },
  ]);

  // ConversionProgress appears first…
  await expect(page.getByTestId("conversion-progress")).toBeVisible();
  // …then the bundle preview once /web/mineru/convert resolves.
  await expect(page.getByTestId("import-preview")).toBeVisible({ timeout: 5000 });
  expect(convertCalls.length).toBe(1);
  expect(convertCalls[0]).toContain("inputSha=");
  // The true original filename is always forwarded to the sidecar.
  expect(convertCalls[0]).toContain("originalFilename=");
});

test("uploads a long office file under the kebab name for MinerU while forwarding the true original", async ({
  page,
}) => {
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: true, hasKey: true } });
  });
  // ADR 0004: ImportPage uploads under the kebab stem (capped at 28 code
  // points) plus the original extension, and forwards the true name separately.
  const longName = "Hybrid Deep Modeling of a CHO-K1 Fed-Batch Process.docx";
  const kebab = "hybrid-deep-modeling-of-a-ch"; // kebabStem(longName)
  // Respond with the markdown named after the kebab stem — the browser looks up
  // `${stem}.md` from the upload name, so the preview only appears if ImportPage
  // actually uploaded under the kebab name.
  const { convertCalls } = await installMineruJobRoutes(page, {
    kind: "success",
    stem: kebab,
    markdown: "# Demo\n\nBody from mineru.\n",
  });

  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: longName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad]),
    },
  ]);

  // Preview appears only when the browser requested the kebab `${stem}.md`.
  await expect(page.getByTestId("import-preview")).toBeVisible({ timeout: 5000 });
  expect(convertCalls.length).toBe(1);
  // The true (long) original is forwarded so frontmatter provenance stays intact.
  expect(convertCalls[0]).toContain(`originalFilename=${encodeURIComponent(longName)}`);
});

test("mineru disabled: office files filtered at selection with a notice, .md still works", async ({
  page,
}) => {
  // Default mockApi already returns enabled=false. Install a defensive
  // route that fails loudly if anything in the UI tries to convert.
  let unexpectedConvertCalls = 0;
  await page.route("**/web/mineru/convert**", async (route) => {
    unexpectedConvertCalls += 1;
    await route.fulfill({
      status: 500,
      body: "/web/mineru/convert called in mineru-disabled flow",
    });
  });

  await page.goto("/#import");
  await expect(page.getByText("Mineru not configured", { exact: false })).toBeVisible();

  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Note\n"),
    },
    // Office files survive setInputFiles (the accept attr is for the UI
    // picker only; programmatic setInputFiles bypasses it) — with mineru
    // disabled they are filtered at selection and never converted.
    {
      name: "ignored.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
  ]);
  // Bundle preview shows for the .md, the office file is reported as filtered,
  // and the convert route was never hit.
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(page.getByText("Skipped 1 file(s) in an unsupported format.")).toBeVisible();
  expect(unexpectedConvertCalls).toBe(0);
});

test("conversion failure: per-file Skip surfaces and dismisses the row", async ({ page }) => {
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: true, hasKey: true } });
  });
  // The quota error now surfaces via the job status, not the convert POST.
  await installMineruJobRoutes(page, {
    kind: "fail",
    error: { code: "mineru_quota", message: "Daily quota exceeded" },
  });

  // Gate on the health probe so mineruEnabled is resolved before we select —
  // otherwise the .pdf is partitioned as native and never converts.
  const healthReady = page.waitForResponse("**/web/mineru/health");
  await page.goto("/#import");
  await healthReady;
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: "fail.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
    },
  ]);

  // The failed row appears with a Skip button.
  await expect(page.getByTestId("conversion-progress")).toBeVisible();
  const row = page.getByTestId("conversion-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Daily quota exceeded");
  await page.getByTestId("conversion-skip").click();
  // Row gone after skip; ConversionProgress eventually transitions away.
  await expect(page.getByTestId("conversion-row")).toHaveCount(0);
});
