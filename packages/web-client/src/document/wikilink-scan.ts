interface WikilinkSpan {
  start: number;
  end: number;
  target: string;
  label: string | null;
}

// Cache the next delimiters, including failed searches. Repeated openers must
// not search the same unclosed suffix again. Spans retain the legacy grammar:
// '[' is allowed in the target, '|' in aliases, and ']' ends either field.
export function* scanWikilinks(
  text: string,
  image: boolean,
  aliasOnly = false,
): Generator<WikilinkSpan> {
  const opener = image ? "![[" : "[[";
  let cursor = 0;
  let close = -1;
  let pipe = -1;
  while (cursor < text.length) {
    const start = text.indexOf(opener, cursor);
    if (start < 0) return;
    const contentStart = start + opener.length;
    if (close < contentStart) close = text.indexOf("]", contentStart);
    if (close < 0) return;
    if (text[close + 1] !== "]") {
      cursor = close + 1;
      continue;
    }
    if (pipe < contentStart) {
      const next = text.indexOf("|", contentStart);
      pipe = next < 0 ? Infinity : next;
    }
    const hasAlias = pipe < close;
    const validAlias = hasAlias && pipe > contentStart && pipe + 1 < close;
    if (
      close === contentStart ||
      (aliasOnly && !validAlias) ||
      (image && hasAlias && !validAlias)
    ) {
      cursor = contentStart;
      continue;
    }
    yield {
      start,
      end: close + 2,
      target: text.slice(contentStart, hasAlias ? pipe : close),
      label: hasAlias ? text.slice(pipe + 1, close) : null,
    };
    cursor = close + 2;
  }
}
