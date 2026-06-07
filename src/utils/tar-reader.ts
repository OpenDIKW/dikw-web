// Minimal USTAR reader: parses the exact shape buildTar emits in
// ``import-bundle.ts`` (mode=0o644, uid=gid=0, mtime=0, magic "ustar\0",
// version "00", typeflag '0'). Used by the browser to consume the tar.gz
// stream returned from /web/mineru/convert. Arbitrary tar shapes
// (PAX, GNU long-name, symlinks, dirs) are intentionally rejected.

const TAR_BLOCK = 512;

export class TarReaderError extends Error {
  readonly code: "unsafe_path" | "bad_checksum" | "truncated" | "unsupported_format";
  constructor(code: TarReaderError["code"], message: string) {
    super(message);
    this.name = "TarReaderError";
    this.code = code;
  }
}

export interface TarEntry {
  archivePath: string;
  data: Uint8Array;
}

function readCstr(view: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  for (let i = offset; i < offset + length; i++) {
    if (view[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder("utf-8").decode(view.subarray(offset, end));
}

function readOctal(view: Uint8Array, offset: number, length: number): number {
  const s = readCstr(view, offset, length).trim();
  if (s === "") return 0;
  const n = parseInt(s, 8);
  // parseInt returns NaN for strings with no leading octal digit (e.g. a tar
  // produced by a non-strict writer that left garbage in a numeric field).
  // We refuse rather than letting NaN silently corrupt offset/size math
  // downstream (`dataStart + NaN === NaN`; comparisons against NaN all return
  // false, masking truncation/overflow checks).
  if (!Number.isFinite(n) || n < 0) {
    throw new TarReaderError(
      "unsupported_format",
      `non-octal numeric tar field at offset ${offset}: ${JSON.stringify(s)}`,
    );
  }
  return n;
}

function isZeroBlock(view: Uint8Array, offset: number): boolean {
  for (let i = 0; i < TAR_BLOCK; i++) {
    if (view[offset + i] !== 0) return false;
  }
  return true;
}

function verifyChecksum(view: Uint8Array, offset: number): boolean {
  const stored = readOctal(view, offset + 148, 8);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    if (i >= 148 && i < 156) {
      sum += 0x20;
    } else {
      sum += view[offset + i];
    }
  }
  return sum === stored;
}

function isUnsafePath(path: string): boolean {
  if (path === "") return true;
  if (path.startsWith("/") || path.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[/\\]/.test(path)) return true;
  const norm = path.replace(/\\+/g, "/");
  for (const seg of norm.split("/")) {
    if (seg === "..") return true;
  }
  return false;
}

export function readTar(input: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let pos = 0;
  while (pos < input.length) {
    if (pos + TAR_BLOCK > input.length) {
      throw new TarReaderError("truncated", `tar truncated at offset ${pos}`);
    }
    if (isZeroBlock(input, pos)) {
      // Standard end marker is two zero blocks. We accept a single zero block
      // at the tail too — buildTar always writes two, but defensive parsers
      // shouldn't crash on a slightly truncated trailer.
      return entries;
    }
    if (!verifyChecksum(input, pos)) {
      throw new TarReaderError("bad_checksum", `tar header checksum mismatch at offset ${pos}`);
    }
    const magic = readCstr(input, pos + 257, 6);
    if (magic !== "ustar") {
      throw new TarReaderError(
        "unsupported_format",
        `unexpected tar magic ${JSON.stringify(magic)} at offset ${pos}`,
      );
    }
    const typeflag = input[pos + 156];
    if (typeflag !== 0 && typeflag !== 0x30) {
      throw new TarReaderError(
        "unsupported_format",
        `unsupported tar typeflag 0x${typeflag.toString(16)} at offset ${pos}`,
      );
    }
    const name = readCstr(input, pos, 100);
    const prefix = readCstr(input, pos + 345, 155);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    if (isUnsafePath(archivePath)) {
      throw new TarReaderError(
        "unsafe_path",
        `unsafe tar entry path: ${JSON.stringify(archivePath)}`,
      );
    }
    const size = readOctal(input, pos + 124, 12);
    const dataStart = pos + TAR_BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > input.length) {
      throw new TarReaderError("truncated", `tar entry ${archivePath} data truncated`);
    }
    entries.push({ archivePath, data: input.slice(dataStart, dataEnd) });
    pos = dataStart + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  return entries;
}
