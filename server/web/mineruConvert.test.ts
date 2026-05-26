// @vitest-environment node
//
// Tests for extractResultZip + safeRelpath. Uses an inline ZIP builder
// (Method 0 stored, plus Method 8 deflate via node:zlib) so we don't
// have to ship binary fixtures or pull a zip-writer dep.

import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  extractResultZip,
  MineruConvertError,
  safeRelpath
} from "./mineruConvert";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

interface ZipFixtureEntry {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
}

function crc32(bytes: Uint8Array): number {
  // Standard CRC-32 for ZIP (polynomial 0xEDB88320).
  let table = (crc32 as unknown as { table?: Uint32Array }).table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }
    (crc32 as unknown as { table?: Uint32Array }).table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildFixtureZip(entries: ZipFixtureEntry[]): Uint8Array {
  // Pre-compute every entry's compressed bytes + CRC.
  const built = entries.map((e) => {
    const method = e.method ?? METHOD_STORED;
    const uncompressed = e.data;
    const compressed =
      method === METHOD_DEFLATE
        ? new Uint8Array(deflateRawSync(uncompressed))
        : uncompressed;
    return {
      ...e,
      method,
      uncompressed,
      compressed,
      crc: crc32(uncompressed)
    };
  });
  // First pass: compute LFH offsets.
  const lfhOffsets: number[] = [];
  let offset = 0;
  const nameBytes: Uint8Array[] = [];
  for (const e of built) {
    lfhOffsets.push(offset);
    const nb = new TextEncoder().encode(e.name);
    nameBytes.push(nb);
    offset += 30 + nb.byteLength + e.compressed.byteLength;
  }
  const cdStart = offset;
  // Compute total CD size to know EOCD offset.
  let cdSize = 0;
  for (let i = 0; i < built.length; i++) {
    cdSize += 46 + nameBytes[i].byteLength;
  }
  const totalSize = cdStart + cdSize + 22;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  // Write LFHs + data.
  for (let i = 0; i < built.length; i++) {
    const e = built[i];
    const off = lfhOffsets[i];
    const nb = nameBytes[i];
    view.setUint32(off, SIG_LFH, true);
    view.setUint16(off + 4, 20, true); // version needed
    view.setUint16(off + 6, FLAG_UTF8, true); // flags
    view.setUint16(off + 8, e.method, true);
    view.setUint16(off + 10, 0, true); // mtime
    view.setUint16(off + 12, 0, true); // mdate
    view.setUint32(off + 14, e.crc, true);
    view.setUint32(off + 18, e.compressed.byteLength, true);
    view.setUint32(off + 22, e.uncompressed.byteLength, true);
    view.setUint16(off + 26, nb.byteLength, true);
    view.setUint16(off + 28, 0, true); // extra len
    buf.set(nb, off + 30);
    buf.set(e.compressed, off + 30 + nb.byteLength);
  }
  // Write CD entries.
  let cdOff = cdStart;
  for (let i = 0; i < built.length; i++) {
    const e = built[i];
    const nb = nameBytes[i];
    view.setUint32(cdOff, SIG_CD, true);
    view.setUint16(cdOff + 4, 20, true); // version made by
    view.setUint16(cdOff + 6, 20, true); // version needed
    view.setUint16(cdOff + 8, FLAG_UTF8, true);
    view.setUint16(cdOff + 10, e.method, true);
    view.setUint16(cdOff + 12, 0, true); // mtime
    view.setUint16(cdOff + 14, 0, true); // mdate
    view.setUint32(cdOff + 16, e.crc, true);
    view.setUint32(cdOff + 20, e.compressed.byteLength, true);
    view.setUint32(cdOff + 24, e.uncompressed.byteLength, true);
    view.setUint16(cdOff + 28, nb.byteLength, true);
    view.setUint16(cdOff + 30, 0, true); // extra
    view.setUint16(cdOff + 32, 0, true); // comment
    view.setUint16(cdOff + 34, 0, true); // disk
    view.setUint16(cdOff + 36, 0, true); // internal attrs
    view.setUint32(cdOff + 38, 0, true); // external attrs
    view.setUint32(cdOff + 42, lfhOffsets[i], true);
    buf.set(nb, cdOff + 46);
    cdOff += 46 + nb.byteLength;
  }
  // Write EOCD.
  const eocd = cdStart + cdSize;
  view.setUint32(eocd, SIG_EOCD, true);
  view.setUint16(eocd + 4, 0, true); // disk
  view.setUint16(eocd + 6, 0, true); // start disk
  view.setUint16(eocd + 8, built.length, true);
  view.setUint16(eocd + 10, built.length, true);
  view.setUint32(eocd + 12, cdSize, true);
  view.setUint32(eocd + 16, cdStart, true);
  view.setUint16(eocd + 20, 0, true); // comment len
  return buf;
}

describe("safeRelpath", () => {
  it("rejects ../ traversal", () => {
    expect(safeRelpath("../escape.png")).toBeNull();
    expect(safeRelpath("a/../../escape.png")).toBeNull();
  });
  it("rejects absolute paths", () => {
    expect(safeRelpath("/etc/passwd")).toBeNull();
  });
  it("rejects Windows drive prefixes via colon", () => {
    expect(safeRelpath("C:/Windows/system32")).toBeNull();
    expect(safeRelpath("fig.png:stream")).toBeNull();
  });
  it("normalizes backslashes to forward slashes", () => {
    expect(safeRelpath("images\\fig.png")).toBe("images/fig.png");
  });
  it("collapses redundant segments", () => {
    expect(safeRelpath("images/./sub/../fig.png")).toBe("images/fig.png");
  });
  it("rejects empty / trailing-slash entries", () => {
    expect(safeRelpath("")).toBeNull();
    expect(safeRelpath("dir/")).toBeNull();
  });
});

describe("extractResultZip", () => {
  it("extracts full.md and a referenced asset, rewrites image refs to wikilink", () => {
    const md = "# Title\n\n![the figure](images/fig.png)\n";
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(md), method: METHOD_DEFLATE },
      { name: "images/fig.png", data: png, method: METHOD_STORED }
    ]);
    const result = extractResultZip(zip);
    expect(result.markdown).toContain("![[assets/images/fig.png|the figure]]");
    expect(result.assets.get("assets/images/fig.png")).toEqual(png);
    expect(result.assets.size).toBe(1);
  });

  it("drops zip-slip entries (../escape.png) silently", () => {
    const md = "# T\n";
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "../escape.png", data: new Uint8Array([1, 2, 3]) }
    ]);
    const result = extractResultZip(zip);
    expect(result.assets.size).toBe(0);
  });

  it("uses full.md only at root; ignores nested full.md", () => {
    const rootMd = "# Root\n";
    const nestedMd = "# DO NOT USE\n";
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(rootMd) },
      { name: "subdir/full.md", data: enc(nestedMd) }
    ]);
    const result = extractResultZip(zip);
    expect(result.markdown).toContain("Root");
    expect(result.markdown).not.toContain("DO NOT USE");
  });

  it("prunes orphan assets (not referenced by markdown)", () => {
    const md = "# Only references fig1\n\n![](images/fig1.png)\n";
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "images/fig1.png", data: new Uint8Array([1, 2, 3]) },
      { name: "images/fig2-orphan.png", data: new Uint8Array([4, 5, 6]) }
    ]);
    const result = extractResultZip(zip);
    expect(result.assets.has("assets/images/fig1.png")).toBe(true);
    expect(result.assets.has("assets/images/fig2-orphan.png")).toBe(false);
  });

  it("leaves external URL refs untouched", () => {
    const md = "# T\n\n![http img](https://example.com/foo.png)\n\n![](images/fig.png)\n";
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "images/fig.png", data: new Uint8Array([1]) }
    ]);
    const result = extractResultZip(zip);
    expect(result.markdown).toContain("https://example.com/foo.png");
    // Standard image syntax preserved for external URL.
    expect(result.markdown).toContain("![http img](https://example.com/foo.png)");
  });

  it("is byte-stable: same input zip → identical extracted markdown + identical asset bytes", () => {
    const md = "# T\n\n![](images/a.png)\n";
    const png = new Uint8Array([0x89, 0x50]);
    const zip1 = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "images/a.png", data: png }
    ]);
    const zip2 = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "images/a.png", data: png }
    ]);
    const r1 = extractResultZip(zip1);
    const r2 = extractResultZip(zip2);
    expect(r1.markdown).toBe(r2.markdown);
    expect(Array.from(r1.assets.keys()).sort()).toEqual(
      Array.from(r2.assets.keys()).sort()
    );
    for (const key of r1.assets.keys()) {
      expect(Array.from(r1.assets.get(key)!)).toEqual(
        Array.from(r2.assets.get(key)!)
      );
    }
  });

  it("throws missing_full_md when ZIP has no full.md at root", () => {
    const zip = buildFixtureZip([
      { name: "other.md", data: enc("# nope") }
    ]);
    expect(() => extractResultZip(zip)).toThrow(MineruConvertError);
    try {
      extractResultZip(zip);
    } catch (err) {
      expect((err as MineruConvertError).code).toBe("missing_full_md");
    }
  });

  it("falls back to basename match when md ref is just a filename", () => {
    const md = "# T\n\n![](fig.png)\n";
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "images/sub/fig.png", data: new Uint8Array([7]) }
    ]);
    const result = extractResultZip(zip);
    expect(result.markdown).toContain("![[assets/images/sub/fig.png]]");
  });

  it("does NOT rewrite when basename match is ambiguous", () => {
    const md = "# T\n\n![](fig.png)\n";
    const zip = buildFixtureZip([
      { name: "full.md", data: enc(md) },
      { name: "a/fig.png", data: new Uint8Array([1]) },
      { name: "b/fig.png", data: new Uint8Array([2]) }
    ]);
    const result = extractResultZip(zip);
    // Original ![](fig.png) preserved; both candidates pruned as orphans.
    expect(result.markdown).toContain("![](fig.png)");
    expect(result.assets.size).toBe(0);
  });
});
