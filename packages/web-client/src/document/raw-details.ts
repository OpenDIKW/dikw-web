// Preserve the exported RegExp's replace/matchAll/exec contract and captures,
// but find blocks once with forward searches instead of backtracking. Do not
// clone `.source`: it describes the opener, not the complete block scanner.
interface DetailsSpan {
  start: number;
  attributesStart: number;
  tagEnd: number;
  summaryStart: number;
  summaryEnd: number;
  contentStart: number;
  end: number;
}

class RawDetailsPattern extends RegExp {
  private body: string | undefined;
  private matches: DetailsSpan[] = [];

  constructor(_source?: string, flags = "gi") {
    super("<details\\b", flags);
  }

  override exec(body: string): RegExpExecArray | null {
    if (this.body !== body) {
      this.body = body;
      this.matches = scanDetails(body, this.ignoreCase);
    }
    const start =
      this.global || this.sticky ? Math.max(0, Math.floor(Number(this.lastIndex) || 0)) : 0;
    // Binary lookup honors arbitrary lastIndex changes without rescanning the
    // document. Symbol.split also uses a sticky copy of this RegExp.
    let low = 0;
    let high = this.matches.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.matches[middle].start < start) low = middle + 1;
      else high = middle;
    }
    const match = this.matches[low];
    if (match && (!this.sticky || match.start === start)) {
      if (this.global || this.sticky) this.lastIndex = match.end;
      // Native RegExp results are fresh arrays; callers may mutate them.
      return Object.assign(
        [
          body.slice(match.start, match.end),
          body.slice(match.attributesStart, match.tagEnd),
          body.slice(match.summaryStart, match.summaryEnd),
          body.slice(match.contentStart, match.end - "</details>".length),
        ] as [string, string, string, string],
        {
          index: match.start,
          input: body,
        },
      );
    }
    if (this.global || this.sticky) this.lastIndex = 0;
    return null;
  }
}

function scanDetails(body: string, ignoreCase: boolean): DetailsSpan[] {
  // ASCII folding keeps UTF-16 offsets intact (Unicode lowercasing may expand).
  const folded = ignoreCase ? body.replace(/[A-Z]/g, (letter) => letter.toLowerCase()) : body;
  const openings = new RegExp("<details\\b", ignoreCase ? "gi" : "g");
  const matches: DetailsSpan[] = [];
  let tagEnd = -1;
  let summaryTagEnd = -1;
  let summaryStart = -1;
  let summaryEnd = -1;
  let detailsEnd = -1;
  for (let open = openings.exec(body); open; open = openings.exec(body)) {
    const attributesStart = open.index + open[0].length;
    if (tagEnd < attributesStart) tagEnd = body.indexOf(">", attributesStart);
    if (tagEnd < 0) break;
    if (summaryTagEnd !== tagEnd) {
      summaryTagEnd = tagEnd;
      summaryStart = tagEnd + 1;
      while (/\s/.test(body[summaryStart] ?? "")) summaryStart++;
      summaryStart = folded.startsWith("<summary>", summaryStart)
        ? summaryStart + "<summary>".length
        : -1;
    }
    if (summaryStart < 0) {
      openings.lastIndex = tagEnd + 1;
      continue;
    }
    if (summaryEnd < summaryStart) summaryEnd = folded.indexOf("</summary>", summaryStart);
    if (summaryEnd < 0) break;
    const contentStart = summaryEnd + "</summary>".length;
    if (detailsEnd < contentStart) detailsEnd = folded.indexOf("</details>", contentStart);
    if (detailsEnd < 0) break;
    const end = detailsEnd + "</details>".length;
    // Keep numeric bounds for every opener, including nested ones. Arbitrary
    // lastIndex searches can select them without storing overlapping strings.
    matches.push({
      start: open.index,
      attributesStart,
      tagEnd,
      summaryStart,
      summaryEnd,
      contentStart,
      end,
    });
  }
  return matches;
}

export const rawDetailsPattern: RegExp = new RawDetailsPattern();
