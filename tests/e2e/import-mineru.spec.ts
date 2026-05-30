// E2E for the mineru-backed PDF/Office import flow. The browser drops a
// file → ImportPage partitions it as mineru-bound → POSTs to the sidecar
// → reads back a synthesized tar.gz with markdown + assets → renders the
// bundle preview. We mock /web/mineru with playwright route handlers,
// so the test never hits mineru.net.

import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { mockDikwApi } from "./mockApi";

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
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
  assets: Array<[string, Uint8Array]>
): { body: Buffer; contentType: string } {
  const entries = [
    { archivePath: `${stem}.md`, data: new TextEncoder().encode(markdown) }
  ];
  for (const [k, v] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    entries.push({ archivePath: k, data: v });
  }
  const tar = buildTar(entries);
  return {
    body: Buffer.from(gzipSync(Buffer.from(tar))),
    contentType: "application/x-tar+gzip"
  };
}

// We bypass the full submit/upload/poll/download chain by mocking
// /web/mineru/convert directly with a pre-built tar.gz — mocking the
// individual mineru.net endpoints isn't useful at the browser-level
// e2e seam (those are covered by server/web/http.test.ts unit tests).

test.beforeEach(async ({ page }) => {
  await mockDikwApi(page);
});

test("dropping a .docx routes through /web/mineru/convert and shows bundle preview", async ({
  page
}) => {
  // Override the default disabled health → enabled.
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: true, hasKey: true } });
  });
  const convertCalls: string[] = [];
  await page.route("**/web/mineru/convert**", async (route) => {
    convertCalls.push(route.request().url());
    const fixture = makeConvertResponse(
      "demo",
      "---\nsource:\n  converter: mineru\n  original_filename: \"demo.docx\"\n  original_sha256: aaa\n---\n# Demo\n\nBody from mineru.\n",
      []
    );
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": fixture.contentType },
      body: fixture.body
    });
  });

  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();

  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: "demo.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad])
    }
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

test("shortens a long office filename for MinerU while forwarding the true original", async ({
  page
}) => {
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: true, hasKey: true } });
  });
  // 26 code points → shortenFileName caps the stem at 25.
  const longStem = "这是一个非常长的中文文件名超过二十五个字符的演示文档";
  const longName = `${longStem}.docx`;
  const shortStem = Array.from(longStem).slice(0, 25).join("");
  const convertCalls: string[] = [];
  await page.route("**/web/mineru/convert**", async (route) => {
    convertCalls.push(route.request().url());
    // Respond with the markdown named after the SHORTENED stem — the browser
    // looks up `${stem}.md` from the upload name, so the preview only appears
    // if ImportPage actually uploaded under the shortened name.
    const fixture = makeConvertResponse(shortStem, "# Demo\n\nBody from mineru.\n", []);
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": fixture.contentType },
      body: fixture.body
    });
  });

  await page.goto("/#import");
  await expect(page.getByRole("heading", { name: "Import" })).toBeVisible();
  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: longName,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad])
    }
  ]);

  // Preview appears only when the browser requested the shortened `${stem}.md`.
  await expect(page.getByTestId("import-preview")).toBeVisible({ timeout: 5000 });
  expect(convertCalls.length).toBe(1);
  // The true (long) original is forwarded so frontmatter provenance stays intact.
  expect(convertCalls[0]).toContain(
    `originalFilename=${encodeURIComponent(longName)}`
  );
});

test("mineru disabled: office files filtered at selection with a notice, .md still works", async ({
  page
}) => {
  // Default mockApi already returns enabled=false. Install a defensive
  // route that fails loudly if anything in the UI tries to convert.
  let unexpectedConvertCalls = 0;
  await page.route("**/web/mineru/convert**", async (route) => {
    unexpectedConvertCalls += 1;
    await route.fulfill({
      status: 500,
      body: "/web/mineru/convert called in mineru-disabled flow"
    });
  });

  await page.goto("/#import");
  await expect(
    page.getByText("Mineru not configured", { exact: false })
  ).toBeVisible();

  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Note\n")
    },
    // Office files survive setInputFiles (the accept attr is for the UI
    // picker only; programmatic setInputFiles bypasses it) — with mineru
    // disabled they are filtered at selection and never converted.
    {
      name: "ignored.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04])
    }
  ]);
  // Bundle preview shows for the .md, the office file is reported as filtered,
  // and the convert route was never hit.
  await expect(page.getByTestId("import-preview")).toBeVisible();
  await expect(
    page.getByText("Skipped 1 file(s) in an unsupported format.")
  ).toBeVisible();
  expect(unexpectedConvertCalls).toBe(0);
});

test("conversion failure: per-file Skip surfaces and dismisses the row", async ({
  page
}) => {
  await page.route("**/web/mineru/health", async (route) => {
    await route.fulfill({ json: { enabled: true, hasKey: true } });
  });
  await page.route("**/web/mineru/convert**", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "mineru_quota", message: "Daily quota exceeded" }
      })
    });
  });

  await page.goto("/#import");
  const fileInput = page.locator('[data-testid="import-file-input"]');
  await fileInput.setInputFiles([
    {
      name: "fail.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46])
    }
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
