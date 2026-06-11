# 4. Source import filename + frontmatter normalization

When files are imported through `#import`, the name they land under in
dikw-core's `sources/` tree is whatever the uploader happened to call the file,
and the frontmatter is whatever the file happened to carry. This ADR records the
decision to normalize both at import time, in dikw-web, before the bundle is
POSTed to `/v1/import`.

## Status

Accepted (2026-06-11). Supersedes the source-naming behaviour described in
`CLAUDE.md` (the mineru `<stem>-<sha12>/` directory layout and the nested
`source: { converter, original_filename, original_sha256 }` frontmatter block).

## Context

dikw-web does no slugification today. Two paths produce source pages:

- **Plain `.md` upload** — `computeProjectRelPath` keeps `file.name` verbatim,
  `archivePath` prefixes `sources/`, and the markdown body is bundled
  unchanged. No frontmatter is injected. Result: names like
  `sources/CortX_Agent_Prompt_V1.md` with **zero** frontmatter.
- **MinerU-converted PDF/Office** — the stem is shortened to ≤25 code points
  only for the upload to mineru, the sidecar injects a nested
  `source: { converter, original_filename, original_sha256 }` block, and
  `convertedToFiles` lays the markdown under a synthetic
  `<stem>-<inputSha[:12]>/` directory. Result: names like
  `sources/01_Biotechnology Progress-71bb3eeaab76/01_Biotechnology Progress.md`.

dikw-core preserves whatever path it receives (`_commit_one_file`:
`os.replace(staging/archive_path, base_root/archive_path)`), reads the
**lowercase** `title` key as the document title (frontmatter `title` → first
`#` heading → file stem, `domains/data/backends/markdown.py:67`), and surfaces
every other frontmatter key read-only in the reader's Frontmatter tab.

Two consequences motivate this ADR:

1. Source names are inconsistent: spaces, underscores, mixed case, CJK,
   trailing whitespace, U+2010 hyphen variants — whatever the source file or
   the mineru pipeline produced.
2. The Frontmatter tab renders a **nested** frontmatter value as a
   `JSON.stringify` blob (`WikiPage.tsx:stringifyFrontmatterValue`), so the
   mineru `source:` object shows up as raw JSON, and plain `.md` pages show no
   provenance at all.

## Decision

Normalize at import time in dikw-web. Real on-disk files already in a base are
**not** migrated; only newly imported files are affected.

### 1. Stored filename: Unicode kebab, CJK preserved, whole name < 32

A new `src/utils/kebab-source-name.ts` derives the archive stem:

- NFC-normalize, then lowercase (ASCII lowercases; CJK is caseless).
- Replace every run of non-letter, non-number characters with `-`
  (`/[^\p{L}\p{N}]+/gu` with the `u` flag). This folds spaces, `_`, ASCII and
  Unicode hyphen variants (U+2010 etc.), and punctuation into `-`, while
  **keeping all letters (including Han) and digits**.
- Collapse repeated `-`, trim leading/trailing `-`.
- Truncate so the **whole filename including `.md` is < 32 code points** (stem
  ≤ 28); re-trim any trailing `-` exposed by truncation. Empty → `untitled`.

Applies to both import paths (the plain-`.md` archive name and the mineru output
stem). Worked examples — these double as the test fixtures:

| Original upload | Stored filename |
| --- | --- |
| `CortX_Agent_Prompt_V1.md` | `cortx-agent-prompt-v1.md` |
| `01_Biotechnology Progress.pdf` | `01-biotechnology-progress.md` |
| `AI 制药研发应用-A.pdf` | `ai-制药研发应用-a.md` |
| `Machine Learning‐Powered .pdf` (U+2010 + trailing space) | `machine-learning-powered.md` |
| `Hybrid deep modeling of a CHO-K1 fed-batch process.pdf` | `hybrid-deep-modeling-of-a-ch.md` (truncated; the full name is kept in `original_filename`) |

### 2. Standardized frontmatter: flat keys, injected or merged

Inject (or merge into existing) a flat block. **No nested objects** — the reader
renders nested values as JSON, so every value is a plain string:

```yaml
# MinerU-converted file
---
original_filename: AI 制药研发应用-A.pdf
converter: mineru
---

# Plain .md upload — no `converter` key
---
original_filename: CortX_Agent_Prompt_V1.md
---
```

- `original_filename` — the **full** original name including extension, for
  exact traceability (the values above quote through `yamlSafe` so spaces / CJK
  round-trip). Always present.
- `converter` — present **only** for converted files (`mineru`). Absent for a
  direct `.md` upload.
- `title` is **not** injected. The document title is left to dikw-core's natural
  resolution (existing frontmatter `title` → first `#` heading → kebab stem), so
  a body H1 wins. The original name is recoverable from `original_filename`, not
  forced into the title.
- `original_sha256` is **not** written to frontmatter. dikw-core does not
  consume it (dedup is by `package_sha256`; mineru conversion idempotency is by
  the client-side IndexedDB `inputSha` cache key). If a future core need arises,
  pass it out-of-band via the manifest, never in displayed frontmatter.
- **No timestamps or other non-deterministic fields.** Injection must be
  deterministic (same input bytes → same frontmatter) or core's
  "same `package_sha256` → dedup" guarantee breaks.

**Merge semantics:** never clobber a key the author already wrote. The client
only ever adds `original_filename`; an existing `original_filename` (e.g. on a
MinerU file the sidecar already stamped) is left untouched — even one written
without a space after the colon (`key:value`) counts as present, so we never
append a duplicate that would make the block unparseable. A leading `---` that
is a CommonMark thematic break (its first non-blank line has no `key:`), not
frontmatter, is detected and a real block is prepended ahead of it rather than
injecting a key into the document body; an unterminated `---` block is left
byte-identical.

### 3. Collision handling and the dropped `-sha12` suffix

The mineru `<stem>-<inputSha[:12]>/` directory suffix is **removed** (it pushed
names past 32). MinerU output is stored as `<kebab-stem>/<kebab-stem>.md` plus
its `assets/`. Collision safety is reframed:

- **Idempotency** (same bytes re-imported) is handled by core's
  `package_sha256` dedup and the client IndexedDB conversion cache — not by the
  filename.
- **Distinct plain names that collapse to the same kebab** (e.g. `Report A.md`
  and `report-a.md` in one batch — different raw paths, same kebab) get a numeric
  `-2`, `-3`, … suffix, kept < 32. This is done in `normalizeForImport`, which
  runs *after* `scanFiles`, so genuine same-raw-path duplicates are already
  resolved.
- **Two MinerU units whose stems kebab to the same root** produce the same raw
  archive path (`<root>/<root>.md`); `scanFiles` already flags the second as a
  **visible** `duplicate_path` skip (surfaced in the import UI), so there is no
  silent data loss. This is the accepted trade for dropping `-sha12` — a
  per-unit batch rename was rejected as over-complex for a rare case.

### Where the code changes land

- `src/utils/kebab-source-name.ts` (new) — `kebabStem` (length-capped) +
  `kebabSourceName` (`<stem>.md`).
- `src/utils/frontmatter-merge.ts` (new) — hand-rolled flat-frontmatter merge.
- `src/utils/import-bundle.ts` — `normalizeForImport` (kebab archive path +
  frontmatter merge + batch numbering), wired before `inspectMarkdownFiles`.
- `src/utils/mineru-convert.ts` — `convertedToFiles` roots at `kebabStem(stem)`,
  dropping the `-sha12` synthetic root.
- `src/pages/ImportPage.tsx` — upload to MinerU under `kebabStem(name)` + the
  original extension (kept for MinerU format detection), forwarding the true name
  via the `originalFilename` query. Replaces the old `shorten-filename.ts`, now
  deleted.
- `server/web/http.ts` — `injectFrontmatter` rewritten to the flat schema (drop
  the nested `source:` object, `original_sha256`, and the now-unused `inputSha`
  arg).

## Consequences

- New imports land under clean, < 32-char kebab names with a consistent,
  JSON-free frontmatter block; the original name is always recoverable from
  `original_filename`.
- The mineru frontmatter wire shape changes (flat keys; no nested `source`; no
  `original_sha256`) and the `-sha12` directory layout is gone. `CLAUDE.md` and
  the import section there are updated in the same change.
- Existing source pages in a live base are **not** renamed or rewritten; this is
  import-time only. A retroactive migration is explicitly out of scope.
- `title` is not injected, so a body `#` heading remains the document title and
  the original name lives only in `original_filename`. A plain `.md` with no
  heading falls back to the kebab stem as its title; the readable original is
  still recoverable from `original_filename`.
- A MinerU input whose stem kebabs to a name another input in the same batch
  already claimed is skipped (`duplicate_path`, visible) rather than renumbered —
  see §3.
- K-layer (`knowledge/`) and wisdom names are unaffected; core already slugifies
  those server-side.

## Testing

TDD against the abnormal real names as fixtures (`CortX_Agent_Prompt_V1.md`,
`01_Biotechnology Progress.pdf`, `AI 制药研发应用-A.pdf`,
`Machine Learning‐Powered .pdf` with U+2010 and trailing space, the long CHO-K1
name). Assert: the kebab/length output in the table above; `original_filename` is
injected into a plain `.md` and merged without clobbering pre-existing
frontmatter; `title` is never injected (a file with an H1 keeps the H1 as its
core title); `converter` is present for mineru and absent for `.md`; no nested
objects and no `original_sha256` reach the frontmatter; distinct plain names that
collapse to the same kebab get numeric suffixes. The MinerU upload-name ↔ result
lookup wiring is covered end-to-end by `tests/e2e/import-mineru.spec.ts` (preview
renders only if the browser uploaded under the kebab name).
