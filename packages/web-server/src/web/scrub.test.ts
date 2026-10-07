// @vitest-environment node
import { describe, expect, it } from "vitest";
import { redact, scrub } from "./scrub";

const KEY = "sk-secret-abcdef0123456789";

describe("scrub", () => {
  it("replaces every occurrence of the key with its redacted suffix", () => {
    const out = scrub(`rejected ${KEY}; retry with ${KEY}`, KEY);
    expect(out).toBe("rejected …6789; retry with …6789");
    expect(out).not.toContain(KEY);
  });

  it("passes the message through when there is no key or no match", () => {
    expect(scrub(`token ${KEY}`, "")).toBe(`token ${KEY}`);
    expect(scrub("upstream 502", KEY)).toBe("upstream 502");
  });

  it("redacts to the last four characters, and an empty key to nothing", () => {
    expect(redact(KEY)).toBe("…6789");
    expect(redact("")).toBe("");
  });
});
