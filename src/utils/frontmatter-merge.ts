// Merge a flat provenance block into a markdown file's YAML frontmatter at
// import time. We only ever ADD ``original_filename`` (and optionally
// ``converter``); a key the author already wrote is never clobbered, and the
// values are flat strings (the Base reader renders nested objects as JSON).
// Hand-rolled because the repo carries no YAML library. See
// docs/adr/0004-source-import-normalization.md.

export interface FrontmatterFields {
  original_filename: string;
  converter?: string;
}

/** Always double-quote so spaces / CJK / quotes round-trip. Mirrors the
 *  server-side ``yamlSafe`` in server/web/http.ts. */
function yamlSafe(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Top-level keys (``^key:``) of a frontmatter block body. Indented (nested)
 *  lines and longer key names are deliberately excluded. */
function topLevelKeys(inner: string): Set<string> {
  const keys = new Set<string>();
  for (const line of inner.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):(?:\s|$)/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function wantedLines(fields: FrontmatterFields): Array<[string, string]> {
  const lines: Array<[string, string]> = [["original_filename", fields.original_filename]];
  if (fields.converter !== undefined) lines.push(["converter", fields.converter]);
  return lines;
}

/** Matches a terminated frontmatter block: opening ``---`` + EOL, lazy body,
 *  EOL + closing ``---``, optional trailing EOL. */
const FRONTMATTER = /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n?)/;

export function mergeFrontmatter(text: string, fields: FrontmatterFields): string {
  const wanted = wantedLines(fields);

  if (!text.startsWith("---")) {
    // No frontmatter — prepend a fresh block in the file's dominant EOL.
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const body = wanted.map(([k, v]) => `${k}: ${yamlSafe(v)}`).join(eol);
    return `---${eol}${body}${eol}---${eol}${text}`;
  }

  const m = text.match(FRONTMATTER);
  if (!m) {
    // Unterminated block — leave byte-identical (mirrors stripFrontmatter).
    return text;
  }

  const openEol = m[1];
  const inner = m[2];
  const closeEol = m[3];
  const trailing = m[4];
  const rest = text.slice(m[0].length);

  const present = topLevelKeys(inner);
  const missing = wanted.filter(([k]) => !present.has(k));
  if (missing.length === 0) return text;

  const addition = missing.map(([k, v]) => `${k}: ${yamlSafe(v)}`).join(openEol);
  const newInner = inner.length === 0 ? addition : `${inner}${openEol}${addition}`;
  return `---${openEol}${newInner}${closeEol}---${trailing}${rest}`;
}
