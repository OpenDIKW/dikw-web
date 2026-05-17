import MarkdownIt from "markdown-it";

export interface FrontmatterMeta {
  title?: string;
  id?: string;
  type?: string;
  kind?: string;
  status?: string;
  created?: string;
  updated?: string;
  tags?: string[];
  sources?: string[];
  [key: string]: string | string[] | undefined;
}

export interface ParsedMarkdownDocument {
  body: string;
  meta: FrontmatterMeta;
}

export interface HeadingEntry {
  level: number;
  title: string;
  slug: string;
}

interface ParseMarkdownOptions {
  stripDuplicateTitle?: string | false;
}

export function parseMarkdownDocument(source: string, options: ParseMarkdownOptions = {}): ParsedMarkdownDocument {
  const normalized = source.replace(/\r\n/g, "\n");
  const frontmatter = extractFrontmatter(normalized);
  if (!frontmatter) {
    return { body: normalized.trimStart(), meta: {} };
  }

  const meta = parseYamlSubset(frontmatter.raw);
  const duplicateTitle =
    options.stripDuplicateTitle === false ? undefined : options.stripDuplicateTitle ?? meta.title;
  const body = duplicateTitle ? stripDuplicateTopHeading(frontmatter.body.trimStart(), duplicateTitle) : frontmatter.body.trimStart();
  return { body, meta };
}

export function getMarkdownTitle(source: string): string | null {
  const parsed = parseMarkdownDocument(source);
  if (parsed.meta.title) {
    return parsed.meta.title;
  }
  const heading = /^#\s+(.+)$/m.exec(parsed.body);
  return heading?.[1]?.trim() || null;
}

function extractFrontmatter(source: string): { raw: string; body: string } | null {
  if (!source.startsWith("---\n")) {
    return null;
  }
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    return null;
  }
  return {
    raw: source.slice(4, end),
    body: source.slice(end + "\n---\n".length)
  };
}

function parseYamlSubset(raw: string): FrontmatterMeta {
  const meta: FrontmatterMeta = {};
  let currentListKey: string | null = null;

  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const listItem = /^\s*-\s+(.+)$/.exec(line);
    if (listItem && currentListKey) {
      const value = cleanScalar(listItem[1]);
      const existing = meta[currentListKey];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else if (typeof existing === "string") {
        meta[currentListKey] = [existing, value];
      } else {
        meta[currentListKey] = [value];
      }
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) {
      currentListKey = null;
      continue;
    }

    const key = pair[1];
    const value = pair[2];
    if (!value.trim()) {
      meta[key] = [];
      currentListKey = key;
    } else {
      meta[key] = cleanScalar(value);
      currentListKey = null;
    }
  }

  return meta;
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripDuplicateTopHeading(body: string, title: string | undefined): string {
  if (!title) {
    return body;
  }
  const match = /^#\s+(.+)\n+/.exec(body);
  if (!match) {
    return body;
  }
  if (normalizeHeading(match[1]) !== normalizeHeading(title)) {
    return body;
  }
  return body.slice(match[0].length);
}

function normalizeHeading(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function uniqueHeadingSlug(env: Record<string, unknown>, value: string): string {
  const slug = slugifyHeading(value);
  if (!slug) {
    return "";
  }
  const counts =
    env.headingSlugCounts instanceof Map
      ? (env.headingSlugCounts as Map<string, number>)
      : new Map<string, number>();
  env.headingSlugCounts = counts;
  const count = counts.get(slug) ?? 0;
  counts.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count + 1}`;
}

// Shared with MarkdownView. Both files use these to identify the same set of
// <details>...</details> blocks. Keep them here as the single source of truth
// so heading slug extraction stays aligned with how MarkdownView renders.
export const rawDetailsPattern = /<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;

export function parseDetailsOpenAttribute(attributes: string): boolean | null {
  const trimmed = attributes.trim();
  if (!trimmed) {
    return false;
  }
  return /^open(?:\s*=\s*(?:"open"|'open'|open|""))?$/i.test(trimmed) ? true : null;
}

// Minimal markdown-it parser used only to enumerate headings. Mirrors the
// parser config used by MarkdownView so the slugs produced here match the
// `id` attributes that MarkdownView writes onto the rendered DOM.
const headingParser = new MarkdownIt({ html: false, linkify: true, typographer: true });

// MarkdownView renders any details block whose `open` attribute parses as
// safe inside its own recursive renderMarkdown() call with a fresh slug
// counter. If extractHeadingsWithSlugs included headings from those blocks in
// the same env as the main body, a heading that shares text with one outside
// would silently collide on the produced slug — outline jumps to "intro-2"
// would never find an element because the in-details heading is rendered with
// id="intro". Drop those blocks here so this extractor only enumerates
// headings that share an env with the main render pass.
function stripPreprocessedDetails(body: string): string {
  return body.replace(rawDetailsPattern, (raw, attributes: string) => {
    const open = parseDetailsOpenAttribute(attributes);
    if (open === null) {
      return raw;
    }
    return "\n\n";
  });
}

export function extractHeadingsWithSlugs(body: string): HeadingEntry[] {
  const stripped = stripPreprocessedDetails(body);
  const env: Record<string, unknown> = {};
  const tokens = headingParser.parse(stripped, env);
  const headings: HeadingEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "heading_open") {
      continue;
    }
    const level = Number(token.tag.slice(1));
    const inline = tokens[i + 1];
    if (!inline || inline.type !== "inline") {
      continue;
    }
    const title = (inline.content ?? "").trim();
    if (!title) {
      continue;
    }
    const slug = uniqueHeadingSlug(env, title);
    if (!slug) {
      continue;
    }
    headings.push({ level, title, slug });
  }
  return headings;
}
