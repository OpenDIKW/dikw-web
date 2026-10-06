import type { MarkdownIt, StateInline } from "markdown-it";

// Index balanced pairs once per inline source. Repeated unclosed tags must not
// repeatedly scan the line tail, and rejected nested pairs must stay literal.
function indexPairs(source: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: { start: number; tag: string }[] = [];
  for (const match of source.matchAll(/\n|<(\/?)(sup|sub)>/gi)) {
    if (match[0] === "\n") {
      stack.length = 0;
    } else if (!match[1]) {
      stack.push({ start: match.index, tag: match[2].toLowerCase() });
    } else {
      const open = stack.pop();
      if (open?.tag === match[2].toLowerCase()) pairs.set(open.start, match.index);
      else stack.length = 0;
    }
  }
  return pairs;
}

/** Attribute-free, single-line scientific marks without enabling raw HTML. */
export function installScientificInline(md: MarkdownIt): void {
  const sources = new WeakMap<StateInline, { pairs: Map<number, number>; rejectedUntil: number }>();
  md.inline.ruler.before("html_inline", "scientific_inline", (state, silent) => {
    const start = state.pos;
    // Link-label lookahead must still inspect inner brackets for nested links.
    if (silent || state.src[start] !== "<") return false;
    const opener = /^<(sup|sub)>/i.exec(state.src.slice(start, start + 5));
    if (!opener) return false;
    let source = sources.get(state);
    if (!source) {
      source = { pairs: indexPairs(state.src), rejectedUntil: -1 };
      sources.set(state, source);
    }
    if (start < source.rejectedUntil) return false;
    const contentEnd = source.pairs.get(start);
    if (contentEnd === undefined || contentEnd + 6 > state.posMax) {
      // An actual unbalanced opener keeps its remainder literal, including any
      // otherwise balanced descendants. Code-span lookalikes never call here.
      const newline = state.src.indexOf("\n", start);
      source.rejectedUntil = newline < 0 ? state.posMax : Math.min(newline, state.posMax);
      return false;
    }
    const end = contentEnd + 6;
    const content = state.src.slice(start + 5, contentEnd);
    // Consume rejected pairs as text too, so a nested tag cannot become live.
    if (/[<>]/.test(content)) {
      state.push("text", "", 0).content = state.src.slice(start, end);
    } else {
      const inner = new md.inline.State(content, md, state.env, []);
      inner.linkLevel = state.linkLevel;
      inner.level = state.level + 1;
      // A bounded src also confines custom rules that search past posMax.
      md.inline.tokenize(inner);
      for (const rule of md.inline.ruler2.getRules("")) rule(inner);
      const tag = opener[1].toLowerCase();
      state.push("scientific_open", tag, 1).meta = { start, end: start + 5 };
      // Keep ordinary tokens visible to image-alt, linkify and typography rules.
      for (const child of inner.tokens) {
        const token = state.push(child.type, child.tag, child.nesting);
        Object.assign(token, child, { level: token.level });
      }
      state.push("scientific_close", tag, -1).meta = { start: contentEnd, end };
    }
    state.pos = end;
    return true;
  });
}
