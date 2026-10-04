import { expect, it } from "vitest";
import { resolveMbWebUrl } from "./mbWebUrl";
it("accepts absolute HTTP(S) application URLs only without credentials, fragments or queries", () => {
  expect(resolveMbWebUrl("https://papers.example.com/app")).toBe("https://papers.example.com/app");
  expect(resolveMbWebUrl("http://localhost:4322")).toBe("http://localhost:4322/");
  for (const raw of [
    undefined,
    "",
    "/papers",
    "javascript:alert(1)",
    "https://user:password@example.com",
    "https://example.com?token=secret",
    "https://example.com#secret",
  ])
    expect(resolveMbWebUrl(raw)).toBeUndefined();
});
