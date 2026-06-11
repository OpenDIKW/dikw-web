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
 *  lines and longer key names are deliberately excluded. The colon may be
 *  followed by anything: a key the author wrote without a space (``key:value``)
 *  still counts as present, so we never append a duplicate that would make the
 *  whole block unparseable. */
function topLevelKeys(inner: string): Set<string> {
  const keys = new Set<string>();
  for (const line of inner.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** Does a ``---`` … ``---`` block body look like YAML frontmatter rather than a
 *  CommonMark thematic break wrapping prose? True if it is empty/all-blank or its
 *  first non-blank line is a mapping key (has a ``key:``) or a YAML comment. A
 *  leading ``---`` followed by prose with no colon (a horizontal rule) is not
 *  frontmatter, so we won't inject a key into the document body. */
function looksLikeFrontmatter(inner: string): boolean {
  for (const line of inner.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    return /^[ \t]*#/.test(line) || /^[ \t]*[A-Za-z0-9_][^:\r\n]*:/.test(line);
  }
  return true;
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
  // Prepend a fresh frontmatter block in the file's dominant EOL.
  const prepend = (): string => {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const body = wanted.map(([k, v]) => `${k}: ${yamlSafe(v)}`).join(eol);
    return `---${eol}${body}${eol}---${eol}${text}`;
  };

  if (!text.startsWith("---")) return prepend();

  // An empty block (``---`` immediately followed by the closing ``---``) is a
  // valid empty mapping but the FRONTMATTER regex can't match it (it needs a
  // body line before the closing fence). Insert our keys between the fences.
  const empty = text.match(/^---(\r?\n)---(\r?\n?)/);
  if (empty) {
    const eol = empty[1];
    const body = wanted.map(([k, v]) => `${k}: ${yamlSafe(v)}`).join(eol);
    return `---${eol}${body}${eol}---${empty[2]}${text.slice(empty[0].length)}`;
  }

  const m = text.match(FRONTMATTER);
  if (!m) {
    // Unterminated block — leave byte-identical (mirrors stripFrontmatter).
    return text;
  }
  if (!looksLikeFrontmatter(m[2])) {
    // The leading ``---`` is a CommonMark thematic break, not frontmatter —
    // prepend a real block so we never inject a key into the document body.
    return prepend();
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
