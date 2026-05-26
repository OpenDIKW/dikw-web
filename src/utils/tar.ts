// Isomorphic USTAR writer. Pure: only uses TextEncoder + Uint8Array,
// so browser (src/utils/import-bundle.ts) and server (server/web/http.ts)
// share one implementation. Drift between two tar formats would break
// the browser's tar-reader which reads sidecar-produced archives.
//
// Output is byte-stable: mode=0o644, uid=gid=0, mtime=0, typeflag '0',
// magic "ustar\0", version "00". Path-splitting per POSIX 1003.1-1988
// (name ≤100, prefix ≤155); anything beyond that throws.

const TAR_BLOCK = 512;
const NAME_FIELD_MAX = 100;
const PREFIX_FIELD_MAX = 155;
const USTAR_PATH_MAX = NAME_FIELD_MAX + 1 + PREFIX_FIELD_MAX;

function writeOctal(view: Uint8Array, offset: number, length: number, value: number): void {
  const oct = value.toString(8);
  if (oct.length > length - 1) {
    throw new Error(`tar field overflow: octal ${oct} does not fit in ${length} bytes`);
  }
  const padded = oct.padStart(length - 1, "0");
  for (let i = 0; i < padded.length; i++) {
    view[offset + i] = padded.charCodeAt(i);
  }
  view[offset + length - 1] = 0;
}

function writeAscii(view: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) {
    throw new Error(`tar field overflow: ${JSON.stringify(value)} exceeds ${length} bytes`);
  }
  for (let i = 0; i < bytes.length; i++) {
    view[offset + i] = bytes[i];
  }
}

export function splitUstarPath(
  archivePath: string
): { name: string; prefix: string } | null {
  const bytes = new TextEncoder().encode(archivePath);
  if (bytes.length <= NAME_FIELD_MAX) {
    return { name: archivePath, prefix: "" };
  }
  if (bytes.length > USTAR_PATH_MAX) {
    return null;
  }
  for (let i = archivePath.length - 1; i > 0; i--) {
    if (archivePath[i] !== "/") continue;
    const head = archivePath.slice(0, i);
    const tail = archivePath.slice(i + 1);
    const headLen = new TextEncoder().encode(head).length;
    const tailLen = new TextEncoder().encode(tail).length;
    if (tailLen <= NAME_FIELD_MAX && headLen <= PREFIX_FIELD_MAX) {
      return { name: tail, prefix: head };
    }
  }
  return null;
}

function ustarHeader(archivePath: string, size: number): Uint8Array {
  const split = splitUstarPath(archivePath);
  if (split === null) {
    throw new Error(
      `archive path too long for USTAR (max ${USTAR_PATH_MAX} bytes, requires PAX extended headers we don't emit): ${archivePath}`
    );
  }
  const header = new Uint8Array(TAR_BLOCK);
  writeAscii(header, 0, 100, split.name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30;
  writeAscii(header, 257, 6, "ustar\0");
  header[263] = 0x30;
  header[264] = 0x30;
  if (split.prefix) {
    writeAscii(header, 345, PREFIX_FIELD_MAX, split.prefix);
  }
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
  const oct = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) header[148 + i] = oct.charCodeAt(i);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export function buildTar(
  entries: ReadonlyArray<{ archivePath: string; data: Uint8Array }>
): Uint8Array {
  let total = 0;
  for (const e of entries) {
    total += TAR_BLOCK;
    total += Math.ceil(e.data.length / TAR_BLOCK) * TAR_BLOCK;
  }
  total += TAR_BLOCK * 2;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const e of entries) {
    const header = ustarHeader(e.archivePath, e.data.length);
    out.set(header, pos);
    pos += TAR_BLOCK;
    out.set(e.data, pos);
    pos += e.data.length;
    const pad = (TAR_BLOCK - (e.data.length % TAR_BLOCK)) % TAR_BLOCK;
    pos += pad;
  }
  return out;
}
