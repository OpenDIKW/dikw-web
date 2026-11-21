import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mergeFrontmatter } from "./frontmatter-merge";
import { kebabSourceName, kebabStem } from "./kebab-source-name";
import { buildTar, splitUstarPath } from "./tar";
import { readTar, TarReaderError } from "./tar-reader";

const UTF8 = new TextEncoder();

// Safe relative path segments that fit USTAR (never empty, never ".", never "..").
const safeSegmentArb = fc
  .stringMatching(/^[a-zA-Z0-9._-]{1,24}$/)
  .filter((seg) => seg !== "." && seg !== "..");

const safeUstarPathArb = fc
  .array(safeSegmentArb, { minLength: 1, maxLength: 10 })
  .map((parts) => parts.join("/"))
  .filter((path) => splitUstarPath(path) !== null);

describe("tar USTAR property invariants", () => {
  it("round-trips arbitrary entries (including >100 byte USTAR prefix splits) byte-for-byte", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            archivePath: safeUstarPathArb,
            data: fc.uint8Array({ minLength: 0, maxLength: 1200 }),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        (entries) => {
          const archive = buildTar(entries);
          expect(archive.length % 512).toBe(0);
          const parsed = readTar(archive);
          expect(parsed).toHaveLength(entries.length);
          for (let i = 0; i < entries.length; i++) {
            expect(parsed[i].archivePath).toBe(entries[i].archivePath);
            expect(parsed[i].data).toEqual(entries[i].data);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("always rejects traversal, absolute, and Windows drive paths with unsafe_path", () => {
    const unsafePathArb = fc.oneof(
      safeSegmentArb.map((s) => `/${s}`),
      safeSegmentArb.map((s) => `\\${s}`),
      safeSegmentArb.map((s) => `../${s}`),
      fc.tuple(safeSegmentArb, safeSegmentArb).map(([a, b]) => `${a}/../${b}`),
      safeSegmentArb.map((s) => `C:/${s}`),
      safeSegmentArb.map((s) => `d:\\${s}`),
    );

    fc.assert(
      fc.property(unsafePathArb, (archivePath) => {
        const archive = buildTar([{ archivePath, data: UTF8.encode("payload") }]);
        let caught: unknown;
        try {
          readTar(archive);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(TarReaderError);
        expect((caught as TarReaderError).code).toBe("unsafe_path");
      }),
      { numRuns: 80 },
    );
  });
});

describe("kebabStem / kebabSourceName property invariants", () => {
  it("is non-empty, idempotent, hyphen-clean, and fits the 100-byte USTAR name field", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 120 }), (raw) => {
        const stem = kebabStem(raw);
        expect(stem.length).toBeGreaterThan(0);
        expect(stem.startsWith("-")).toBe(false);
        expect(stem.endsWith("-")).toBe(false);
        expect(stem).not.toContain("--");
        expect(kebabStem(stem)).toBe(stem);

        const sourceName = kebabSourceName(raw);
        expect(sourceName.endsWith(".md")).toBe(true);
        expect(UTF8.encode(sourceName).length).toBeLessThanOrEqual(100);
        expect(kebabSourceName(sourceName)).toBe(sourceName);
      }),
      { numRuns: 200 },
    );
  });
});

describe("mergeFrontmatter property invariants", () => {
  const singleLineValueArb = fc
    .string({ minLength: 1, maxLength: 40 })
    .map((s) => s.replace(/[\r\n]/g, " "));

  const fieldsArb = fc.record({
    original_filename: singleLineValueArb,
    converter: fc.option(singleLineValueArb, { nil: undefined }),
  });

  const markdownDocArb = fc.oneof(
    fc.string({ maxLength: 120 }),
    fc
      .tuple(fc.stringMatching(/^[a-z]{1,12}$/), singleLineValueArb, fc.string({ maxLength: 80 }))
      .map(([k, v, body]) => `---\n${k}: ${v}\n---\n${body}`),
    fc.string({ maxLength: 80 }).map((body) => `---\n---\n${body}`),
    fc.string({ maxLength: 80 }).map((body) => `---\njust prose without a colon\n---\n${body}`),
  );

  it("is idempotent across arbitrary documents and provenance fields", () => {
    fc.assert(
      fc.property(markdownDocArb, fieldsArb, (doc, fields) => {
        const once = mergeFrontmatter(doc, fields);
        const twice = mergeFrontmatter(once, fields);
        expect(twice).toBe(once);
      }),
      { numRuns: 150 },
    );
  });

  it("never clobbers an author's existing original_filename or converter key", () => {
    fc.assert(
      fc.property(
        singleLineValueArb,
        singleLineValueArb,
        fieldsArb,
        fc.string({ maxLength: 60 }),
        (authorFile, authorConv, incoming, body) => {
          const doc = `---\noriginal_filename: ${authorFile}\nconverter: ${authorConv}\n---\n${body}`;
          const merged = mergeFrontmatter(doc, incoming);
          expect(merged).toBe(doc);
        },
      ),
      { numRuns: 100 },
    );
  });
});
