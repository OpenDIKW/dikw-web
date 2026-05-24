import { describe, expect, it } from "vitest";
import {
  archivePath,
  buildImportBundle,
  buildTar,
  computePackageSha256,
  computeProjectRelPath,
  gzip,
  inspectMarkdownFiles,
  scanFiles,
  sha256Hex,
  sha256HexString,
  splitUstarPath
} from "./import-bundle";

function file(path: string, body: BodyInit, type = ""): File {
  // Tests synthesize files with ``webkitRelativePath`` via a defineProperty
  // shim — File's constructor does not accept that field directly.
  const parts: BlobPart[] = typeof body === "string" ? [body] : [body as BlobPart];
  const f = new File(parts, path.split("/").pop()!, { type });
  Object.defineProperty(f, "webkitRelativePath", { value: path, configurable: true });
  return f;
}

describe("computeProjectRelPath / archivePath", () => {
  it("strips the leading directory segment from webkitRelativePath", () => {
    expect(computeProjectRelPath(file("MyVault/notes/foo.md", ""))).toBe(
      "notes/foo.md"
    );
  });

  it("falls back to file.name when webkitRelativePath is empty", () => {
    const bare = new File([""], "loose.md");
    expect(computeProjectRelPath(bare)).toBe("loose.md");
  });

  it("archivePath keeps an existing sources/ prefix and adds it otherwise", () => {
    expect(archivePath("sources/notes/x.md")).toBe("sources/notes/x.md");
    expect(archivePath("notes/x.md")).toBe("sources/notes/x.md");
  });
});

describe("scanFiles", () => {
  it("buckets by extension and reports unsupported as skipped", () => {
    const files = [
      file("V/a.md", "# a"),
      file("V/img/b.png", new Uint8Array([0x89, 0x50])),
      file("V/garbage.zip", new Uint8Array([0]))
    ];
    const out = scanFiles(files);
    expect(out.mdPaths).toEqual(["a.md"]);
    expect(out.byProjectRel.has("img/b.png")).toBe(true);
    expect(out.byProjectRel.has("garbage.zip")).toBe(false);
    expect(out.skipped).toEqual([
      { path: "garbage.zip", reason: "unsupported_extension" }
    ]);
  });

  it("flags duplicate project-rel paths as skipped instead of letting them slip through", () => {
    // Two distinct File objects that strip to the same project-rel — server
    // would reject with manifest_duplicate_md_path; we surface it locally.
    const files = [
      file("V1/note.md", "first body"),
      file("V2/note.md", "second body, different content")
    ];
    const out = scanFiles(files);
    expect(out.mdPaths).toEqual(["note.md"]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatchObject({
      path: "note.md",
      reason: "duplicate_path"
    });
  });
});

describe("splitUstarPath", () => {
  it("returns just name for short paths", () => {
    expect(splitUstarPath("sources/a.md")).toEqual({
      name: "sources/a.md",
      prefix: ""
    });
  });

  it("splits longer paths on a / boundary into prefix + name", () => {
    const path = "sources/" + "a".repeat(50) + "/" + "b".repeat(50) + "/file.md";
    const split = splitUstarPath(path);
    expect(split).not.toBeNull();
    expect(split!.name).toBe("file.md");
    expect(split!.prefix).toBe("sources/" + "a".repeat(50) + "/" + "b".repeat(50));
  });

  it("returns null when the path can't fit in name(100)+prefix(155)", () => {
    expect(splitUstarPath("sources/" + "x".repeat(300))).toBeNull();
  });

  it("returns null when no valid / split exists in the budget", () => {
    // 200-byte single segment — no / boundary inside the prefix budget
    expect(splitUstarPath("a".repeat(200))).toBeNull();
  });
});

describe("inspectMarkdownFiles", () => {
  it("packages md with resolved assets", async () => {
    const files = [
      file(
        "V/notes/foo.md",
        "---\ntitle: foo\n---\n\nBody ![[diagram.png]]\n"
      ),
      file("V/notes/diagram.png", new Uint8Array([1, 2, 3]))
    ];
    const scan = scanFiles(files);
    const out = await inspectMarkdownFiles(scan);
    expect(out.packages).toEqual([
      {
        mdProjectRel: "notes/foo.md",
        assetsProjectRel: ["notes/diagram.png"]
      }
    ]);
    expect(out.skipped).toEqual([]);
  });

  it("rejects md that references a missing asset", async () => {
    const files = [
      file("V/notes/foo.md", "Body ![[missing.png]]\n")
    ];
    const scan = scanFiles(files);
    const out = await inspectMarkdownFiles(scan);
    expect(out.packages).toEqual([]);
    expect(out.skipped).toEqual([
      { path: "notes/foo.md", reason: "asset_missing", detail: "missing.png" }
    ]);
  });

  it("rejects md with empty body after stripping frontmatter", async () => {
    const files = [file("V/x.md", "---\ntitle: x\n---\n  \n")];
    const scan = scanFiles(files);
    const out = await inspectMarkdownFiles(scan);
    expect(out.packages).toEqual([]);
    expect(out.skipped[0]).toMatchObject({ path: "x.md", reason: "empty_body" });
  });

  it("drops remote URLs without flagging the md as missing", async () => {
    const files = [
      file("V/x.md", "Has remote ![alt](https://example.com/x.png) and nothing else.\n")
    ];
    const scan = scanFiles(files);
    const out = await inspectMarkdownFiles(scan);
    expect(out.packages).toEqual([
      { mdProjectRel: "x.md", assetsProjectRel: [] }
    ]);
  });

  it("reports unresolvable file: URI as a missing asset (matches core _is_remote)", async () => {
    // core's md_inspect._is_remote returns False for ``file:`` schemes, so the
    // ref must round-trip through resolveAssetRef and end up flagged missing
    // when no candidate exists. Earlier versions silently dropped it.
    const files = [
      file("V/x.md", "Bad ref ![alt](file:///tmp/missing.png) here.\n")
    ];
    const scan = scanFiles(files);
    const out = await inspectMarkdownFiles(scan);
    expect(out.packages).toEqual([]);
    expect(out.skipped[0]).toMatchObject({
      path: "x.md",
      reason: "asset_missing"
    });
  });
});

describe("computePackageSha256 (must agree with dikw-core)", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);

  it("matches Python golden for md-only", async () => {
    expect(await computePackageSha256(A, [])).toBe(
      "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"
    );
  });

  it("matches Python golden for md + 1 asset", async () => {
    expect(await computePackageSha256(A, [B])).toBe(
      "5e9ae866add9a85d69c3481d059bb9f158a39e5670ba11f95112fc409630894e"
    );
  });

  it("sort order is independent of input order", async () => {
    expect(await computePackageSha256(C, [B, A])).toBe(
      "3a9126ada7449a9ae43078e666cc5105bcd9700245277275a7a95ab954d338df"
    );
    expect(await computePackageSha256(C, [A, B])).toBe(
      "3a9126ada7449a9ae43078e666cc5105bcd9700245277275a7a95ab954d338df"
    );
  });
});

describe("sha256 helpers", () => {
  it("matches a known hex digest for ASCII bytes", async () => {
    expect(await sha256HexString("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("hashes Uint8Array consistently", async () => {
    expect(await sha256Hex(new TextEncoder().encode("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });
});

describe("buildTar (USTAR structure)", () => {
  it("writes a parseable header for a single file", () => {
    const data = new TextEncoder().encode("hello");
    const tar = buildTar([{ archivePath: "sources/a.md", data }]);
    // 1 header (512) + 1 padded data block (512) + 2 end zero blocks (1024)
    expect(tar.length).toBe(2048);

    // Name field
    const name = new TextDecoder().decode(tar.slice(0, 12)).replace(/\0+$/, "");
    expect(name).toBe("sources/a.md");

    // Size field at offset 124 (12 bytes, null-terminated octal)
    const sizeField = new TextDecoder()
      .decode(tar.slice(124, 124 + 11))
      .trim();
    expect(parseInt(sizeField, 8)).toBe(5);

    // Typeflag = '0' (regular file)
    expect(String.fromCharCode(tar[156])).toBe("0");

    // ustar magic
    expect(new TextDecoder().decode(tar.slice(257, 262))).toBe("ustar");

    // Checksum: sum of header bytes with chksum field forced to spaces.
    const headerCopy = tar.slice(0, 512).slice();
    for (let i = 148; i < 156; i++) headerCopy[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += headerCopy[i];
    const chksumField = new TextDecoder().decode(tar.slice(148, 154));
    expect(parseInt(chksumField, 8)).toBe(sum);

    // Data starts at offset 512
    expect(new TextDecoder().decode(tar.slice(512, 517))).toBe("hello");

    // End-of-archive: last 1024 bytes should all be zero
    for (let i = 1024; i < 2048; i++) expect(tar[i]).toBe(0);
  });

  it("uses the USTAR prefix field to fit paths up to 256 bytes (name 100 + '/' + prefix 155)", () => {
    // A 150-byte project-rel path (under sources/) — splits cleanly.
    const longPath = "sources/" + "a".repeat(50) + "/" + "b".repeat(50) + "/x.md";
    const tar = buildTar([{ archivePath: longPath, data: new Uint8Array(0) }]);
    // Name field carries the trailing component ('x.md')
    expect(
      new TextDecoder().decode(tar.slice(0, 5)).replace(/\0+$/, "")
    ).toBe("x.md");
    // Prefix field at offset 345 carries the leading dirs
    expect(
      new TextDecoder().decode(tar.slice(345, 345 + 60)).replace(/\0+$/, "")
    ).toContain("sources/");
  });

  it("rejects archive paths longer than the USTAR 256-byte budget", () => {
    expect(() =>
      buildTar([
        { archivePath: "sources/" + "x".repeat(300), data: new Uint8Array(0) }
      ])
    ).toThrow(/USTAR/);
  });
});

describe("gzip helper", () => {
  it("produces a gzip stream that starts with the 0x1f 0x8b magic", async () => {
    const blob = await gzip(new TextEncoder().encode("hello"));
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect(Array.from(head)).toEqual([0x1f, 0x8b]);
  });
});

describe("buildImportBundle (end to end)", () => {
  it("packages md + asset, produces a stable manifest, gzips the tar", async () => {
    const files = [
      file("V/notes/a.md", "Has ![[diagram.png]] embed.\n"),
      file("V/notes/diagram.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    ];
    const out = await buildImportBundle(files);

    expect(out.filesCount).toBe(2);
    expect(out.manifest.files.map((f) => f.path)).toEqual([
      "sources/notes/a.md",
      "sources/notes/diagram.png"
    ]);
    expect(out.manifest.packages).toHaveLength(1);
    expect(out.manifest.packages[0].md_path).toBe("sources/notes/a.md");
    expect(out.manifest.packages[0].asset_paths).toEqual([
      "sources/notes/diagram.png"
    ]);
    // package_sha256 must equal the formula applied to the file shas the manifest reports
    const mdSha = out.manifest.files.find((f) => f.path.endsWith("a.md"))!.sha256;
    const assetSha = out.manifest.files.find((f) => f.path.endsWith("diagram.png"))!
      .sha256;
    expect(out.manifest.packages[0].package_sha256).toBe(
      await computePackageSha256(mdSha, [assetSha])
    );
    // Total bytes = sum of file sizes
    expect(out.totalBytes).toBe(out.manifest.files.reduce((s, f) => s + f.size, 0));
    // Payload is a Blob with gzip magic
    const head = new Uint8Array(await out.payload.slice(0, 2).arrayBuffer());
    expect(Array.from(head)).toEqual([0x1f, 0x8b]);
  });

  it("dedupes an asset shared by two md files", async () => {
    const png = new Uint8Array([1, 2, 3]);
    const files = [
      file("V/a.md", "Embed ![[shared.png]] here.\n"),
      file("V/b.md", "Also embeds ![[shared.png]] over here.\n"),
      file("V/shared.png", png)
    ];
    const out = await buildImportBundle(files);
    expect(out.manifest.files.map((f) => f.path).sort()).toEqual([
      "sources/a.md",
      "sources/b.md",
      "sources/shared.png"
    ]);
    expect(out.manifest.packages).toHaveLength(2);
    expect(out.manifest.packages[0].asset_paths).toEqual(["sources/shared.png"]);
    expect(out.manifest.packages[1].asset_paths).toEqual(["sources/shared.png"]);
  });

  it("throws when no md remains importable", async () => {
    const files = [file("V/x.md", "Has ![[missing.png]] but nothing else.\n")];
    await expect(buildImportBundle(files)).rejects.toMatchObject({
      code: "no_packages"
    });
  });

  it("warns about unreferenced assets without blocking the import", async () => {
    // User selected an md plus a bunch of pngs but only one is actually embedded.
    // The unreferenced pngs should surface in ``skipped`` (warning) and stay
    // out of the bundle. The advertised md still goes through.
    const files = [
      file("V/a.md", "Has ![[used.png]] only.\n"),
      file("V/used.png", new Uint8Array([1])),
      file("V/unused.png", new Uint8Array([2, 3])),
      file("V/also-unused.jpg", new Uint8Array([4, 5, 6]))
    ];
    const out = await buildImportBundle(files);
    expect(out.manifest.files.map((f) => f.path).sort()).toEqual([
      "sources/a.md",
      "sources/used.png"
    ]);
    const unrefSkips = out.skipped.filter(
      (s) => s.reason === "unreferenced_asset"
    );
    expect(unrefSkips.map((s) => s.path).sort()).toEqual([
      "also-unused.jpg",
      "unused.png"
    ]);
  });
});
