import { describe, expect, it } from "vitest";
import { InvalidNdjsonError, parseNdjsonBuffer } from "./ndjson";

describe("parseNdjsonBuffer", () => {
  it("parses complete lines and keeps the trailing partial line", () => {
    const result = parseNdjsonBuffer('{"type":"a"}\n{"type":"b"');
    expect(result.events).toEqual([{ type: "a" }]);
    expect(result.tail).toBe('{"type":"b"');
  });

  it("ignores empty lines", () => {
    const result = parseNdjsonBuffer('\n{"type":"a"}\n\n');
    expect(result.events).toEqual([{ type: "a" }]);
    expect(result.tail).toBe("");
  });

  it("throws on malformed JSON lines", () => {
    expect(() => parseNdjsonBuffer("{not json}\n")).toThrow(InvalidNdjsonError);
  });
});
