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
