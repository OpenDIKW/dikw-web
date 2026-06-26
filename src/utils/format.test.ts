import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatScore,
  isTerminalTask,
  statusTone,
  truncateMiddle,
} from "./format";

describe("format helpers", () => {
  it("formats numbers, scores, and percents for display", () => {
    expect(formatNumber(12345)).toBe("12,345");
    expect(formatScore(0.98765)).toBe("0.988");
    expect(formatScore(undefined)).toBe("-");
    expect(formatPercent(0.864)).toBe("86%");
  });

  it("formats task duration defensively", () => {
    expect(formatDuration("2026-05-05T09:00:00Z", "2026-05-05T09:00:09.5Z")).toBe("9.5s");
    expect(formatDuration("2026-05-05T09:00:00Z", "2026-05-05T09:01:04Z")).toBe("1m 4s");
    expect(formatDuration(null, "2026-05-05T09:01:04Z")).toBe("-");
    expect(formatDuration("bad", "2026-05-05T09:01:04Z")).toBe("-");
  });

  it("formats a wall-clock time for the freshness stamp", () => {
    expect(formatClockTime(new Date(2026, 5, 26, 20, 41))).toBe("20:41");
    expect(formatClockTime(new Date(2026, 5, 26, 9, 5))).toBe("09:05");
  });

  it("maps statuses and truncates long identifiers", () => {
    expect(statusTone("succeeded")).toBe("ok");
    expect(statusTone("candidate")).toBe("info");
    expect(statusTone("failed")).toBe("bad");
    expect(statusTone("archived")).toBe("warn");
    expect(statusTone("unknown")).toBe("muted");
    expect(isTerminalTask("succeeded")).toBe(true);
    expect(isTerminalTask("running")).toBe(false);
    expect(truncateMiddle("wiki/a/very/long/path/to/a/document.md", 18)).toMatch(
      /^wiki\/a\/v\.\.\./,
    );
  });
});
