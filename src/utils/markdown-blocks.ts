// Splits a markdown body into ordered blocks for the Base reader's bilingual
// view. "text" blocks (paragraphs, headings, lists, quotes) are translated and
// shown paragraph-aligned with their translation; "special" blocks (fenced code
// incl. mermaid, pipe / raw-HTML tables, <details> charts, $$ display math, and
// thematic breaks) are rendered ONCE, centered, and never translated.
//
// Range-first: locate atomic special spans, then split the gaps between them on
// blank lines. The CommonMark fence scanner + range merge are reused from
// source-inline-refs, so a blank line or a `#` *inside* a code fence never
// starts a new block.

import { rawDetailsPattern } from "./markdown";
import { collectFencedCodeRanges, mergeRanges, type ProtectedRange } from "./source-inline-refs";

export type MarkdownBlockKind = "text" | "special";

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  /** The original markdown slice, trimmed of surrounding blank lines. */
  md: string;
}

const DISPLAY_MATH_PATTERN = /\$\$[\s\S]*?\$\$/g;
const RAW_TABLE_PATTERN = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
// 3+ of the same marker (-, *, _), optionally space-separated, alone on a line.
const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
// Image embeds the reader renders: Obsidian `![[path]]` and CommonMark
// `![alt](url "title")`. Used to detect blocks that are *only* image(s).
const OBSIDIAN_IMAGE = /!\[\[[^\]]*\]\]/g;
const COMMONMARK_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

/** Split `body` into ordered text / special blocks (see module header). */
export function splitMarkdownBlocks(body: string): MarkdownBlock[] {
  const text = body.replace(/\r\n/g, "\n");
  const ranges = mergeRanges([
    ...collectFencedCodeRanges(text),
    ...collectRegexRanges(text, rawDetailsPattern),
    ...collectRegexRanges(text, RAW_TABLE_PATTERN),
    ...collectRegexRanges(text, DISPLAY_MATH_PATTERN),
    ...collectPipeTableRanges(text),
    ...collectThematicBreakRanges(text),
    ...collectImageLineRanges(text),
  ]);

  const blocks: MarkdownBlock[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) pushTextBlocks(blocks, text.slice(cursor, range.start));
    const md = text.slice(range.start, range.end).trim();
    if (md) blocks.push({ kind: "special", md });
    cursor = range.end;
  }
  if (cursor < text.length) pushTextBlocks(blocks, text.slice(cursor));
  return blocks;
}

/** Split a plain (non-special) stretch on blank lines into text blocks. */
function pushTextBlocks(blocks: MarkdownBlock[], chunk: string): void {
  for (const part of chunk.split(/\n[ \t]*\n/)) {
    const md = part.trim();
    if (md) blocks.push({ kind: "text", md });
  }
}

/** Standalone-image LINES are special: a figure on its own line renders once
 *  (centered) instead of being duplicated — and alt-translated — across both
 *  bilingual columns. Detecting at the *line* level (not the whole blank-line
 *  block) also splits a figure off a caption joined to it by a hard line break,
 *  which is how MinerU emits captioned figures (the Fig. 2 case on cho-cqa). A
 *  line inside a fenced code block / table / details is absorbed by that larger
 *  range during `mergeRanges`, so code samples showing image syntax are safe. */
function collectImageLineRanges(body: string): ProtectedRange[] {
  const { lines, starts } = lineIndex(body);
  const ranges: ProtectedRange[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isImageOnlyLine(lines[i].trim())) {
      ranges.push(rangeForLines(body, starts, lines, i, i));
    }
  }
  return ranges;
}

/** True when `line` is non-empty and contains only image embed(s) plus
 *  link/whitespace punctuation — a standalone figure (incl. a linked image
 *  `[![alt](img)](href)`), not prose with an inline image. */
function isImageOnlyLine(line: string): boolean {
  if (line.length === 0) return false;
  // A list-item / blockquote line that holds only an image is still part of that
  // structure; pulling it out as a standalone figure would break the surrounding
  // list/quote, so leave it as translatable text. (Ordered-list markers like
  // `1.` carry a digit and are already excluded by the alphanumeric check below.)
  if (/^[-*+>]\s/.test(line)) return false;
  let rest = line.replace(OBSIDIAN_IMAGE, "").replace(COMMONMARK_IMAGE, "");
  if (rest === line) return false; // no image embed present
  // A linked image `[![alt](img)](href)` leaves an empty-label link `[](href)`
  // once the image is removed — strip that shell so the URL doesn't read as prose.
  rest = rest.replace(/\[\s*\]\([^)]*\)/g, "");
  return !/[\p{L}\p{N}]/u.test(rest); // only brackets / punctuation / space left
}

function collectRegexRanges(body: string, pattern: RegExp): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

function lineIndex(body: string): { lines: string[]; starts: number[] } {
  const lines = body.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1; // +1 for the \n separator
  }
  return { lines, starts };
}

function rangeForLines(
  body: string,
  starts: number[],
  lines: string[],
  first: number,
  last: number,
): ProtectedRange {
  const start = starts[first];
  let end = starts[last] + lines[last].length;
  if (end < body.length && body[end] === "\n") end += 1; // include trailing newline
  return { start, end };
}

/** A pipe-table delimiter row: only |-:  whitespace, with at least one of each
 *  pipe and dash (e.g. `|---|:--:|`, `--- | ---`). */
function isTableDelimiter(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.includes("-") && /^[|\-:\s]+$/.test(t);
}

function collectPipeTableRanges(body: string): ProtectedRange[] {
  const { lines, starts } = lineIndex(body);
  const ranges: ProtectedRange[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const delimiter = lines[i + 1];
    if (
      header.includes("|") &&
      header.trim() !== "" &&
      delimiter !== undefined &&
      isTableDelimiter(delimiter)
    ) {
      let last = i + 1;
      while (
        last + 1 < lines.length &&
        lines[last + 1].trim() !== "" &&
        lines[last + 1].includes("|")
      ) {
        last += 1;
      }
      ranges.push(rangeForLines(body, starts, lines, i, last));
      i = last + 1;
    } else {
      i += 1;
    }
  }
  return ranges;
}

function collectThematicBreakRanges(body: string): ProtectedRange[] {
  const { lines, starts } = lineIndex(body);
  const ranges: ProtectedRange[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!THEMATIC_BREAK.test(lines[i])) continue;
    // A marker line directly under non-blank text is a setext heading underline,
    // not a thematic break — leave it with the text so it renders as a heading.
    if (i > 0 && lines[i - 1].trim() !== "") continue;
    ranges.push(rangeForLines(body, starts, lines, i, i));
  }
  return ranges;
}
