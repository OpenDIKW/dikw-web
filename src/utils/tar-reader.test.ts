// Round-trip tar-reader against buildTar. We only need to parse the exact
// USTAR shape buildTar emits (mode=0o644, uid=gid=0, mtime=0, magic "ustar\0",
// version "00", typeflag '0'); arbitrary tars are out of scope.

import { describe, expect, it } from "vitest";
import { buildTar } from "./import-bundle";
import { readTar, TarReaderError } from "./tar-reader";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("readTar", () => {
  it("round-trips a single entry", () => {
    const entries = [{ archivePath: "sources/a.md", data: enc("hello") }];
    const tar = buildTar(entries);
    const parsed = readTar(tar);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].archivePath).toBe("sources/a.md");
    expect(new TextDecoder().decode(parsed[0].data)).toBe("hello");
  });

  it("round-trips multiple entries preserving order and byte-equality", () => {
    const entries = [
      { archivePath: "sources/foo.md", data: enc("# foo\n") },
      { archivePath: "sources/foo/assets/img.png", data: new Uint8Array([1, 2, 3, 4, 5]) },
      { archivePath: "sources/bar.md", data: enc("# bar with **bold**\n") }
    ];
    const tar = buildTar(entries);
    const parsed = readTar(tar);
    expect(parsed.map((e) => e.archivePath)).toEqual([
      "sources/foo.md",
      "sources/foo/assets/img.png",
      "sources/bar.md"
    ]);
    for (let i = 0; i < entries.length; i++) {
      // Compare via Array.from because Vitest's TypedArray deep-equal can
      // misreport identical byte sequences when underlying ArrayBuffers
      // differ in capacity/offset (which they do: parsed slice has its own
      // fresh buffer, vs the original passed in by the test).
      expect(Array.from(parsed[i].data)).toEqual(Array.from(entries[i].data));
    }
  });

  it("round-trips a path that requires USTAR prefix splitting (>100 bytes)", () => {
    // 120-char path forces splitUstarPath to use the prefix field.
    const longDir = "a".repeat(60);
    const longName = "b".repeat(60);
    const path = `${longDir}/${longName}.md`;
    expect(path.length).toBe(124);
    const entries = [{ archivePath: path, data: enc("body") }];
    const tar = buildTar(entries);
    const parsed = readTar(tar);
    expect(parsed[0].archivePath).toBe(path);
    expect(new TextDecoder().decode(parsed[0].data)).toBe("body");
  });

  it("rejects an entry path with .. segment (zip-slip defense)", () => {
    const entries = [{ archivePath: "../escape.png", data: enc("x") }];
    const tar = buildTar(entries);
    expect(() => readTar(tar)).toThrow(TarReaderError);
    try {
      readTar(tar);
    } catch (err) {
      expect((err as TarReaderError).code).toBe("unsafe_path");
    }
  });

  it("rejects an absolute entry path", () => {
    // buildTar happily writes whatever path we give it; readTar is the gate.
    const entries = [{ archivePath: "/etc/passwd", data: enc("x") }];
    const tar = buildTar(entries);
    expect(() => readTar(tar)).toThrow(TarReaderError);
    try {
      readTar(tar);
    } catch (err) {
      expect((err as TarReaderError).code).toBe("unsafe_path");
    }
  });

  it("rejects a tar with a corrupt checksum", () => {
    const entries = [{ archivePath: "ok.md", data: enc("hi") }];
    const tar = buildTar(entries);
    // Flip a byte inside the data so the header checksum no longer matches.
    // Header is 512 bytes, so byte 512 is the first data byte.
    tar[512] ^= 0xff;
    // We don't reverify content but DO verify header checksum at parse time:
    // mutate the name field instead.
    const tar2 = buildTar(entries);
    tar2[0] ^= 0xff;
    expect(() => readTar(tar2)).toThrow(TarReaderError);
  });

  it("rejects a tar that is too short to contain a header", () => {
    const tar = new Uint8Array(300);
    expect(() => readTar(tar)).toThrow(TarReaderError);
  });

  it("stops at the two-zero-block end marker (ignores trailing garbage)", () => {
    const entries = [{ archivePath: "a.md", data: enc("a") }];
    const tar = buildTar(entries);
    // Append a block of garbage after the legitimate two zero blocks.
    const garbage = new Uint8Array(512).fill(0xab);
    const extended = new Uint8Array(tar.length + garbage.length);
    extended.set(tar, 0);
    extended.set(garbage, tar.length);
    const parsed = readTar(extended);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].archivePath).toBe("a.md");
  });
});
