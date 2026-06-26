import type { TaskStatus } from "../types";

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(3);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

export function formatUnixSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

/** Wall-clock `HH:MM` (24-hour) for a "last updated" freshness stamp. */
export function formatClockTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export function formatIso(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) {
    return "-";
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return "-";
  }
  const seconds = (endMs - startMs) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function statusTone(status: string): "ok" | "warn" | "bad" | "muted" | "info" {
  if (status === "ready" || status === "ok" || status === "succeeded" || status === "approved") {
    return "ok";
  }
  if (status === "running" || status === "pending" || status === "candidate") {
    return "info";
  }
  if (status === "cancelled" || status === "archived") {
    return "warn";
  }
  if (status === "failed" || status === "error") {
    return "bad";
  }
  return "muted";
}

export function isTerminalTask(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function displayTitle(doc: { title: string | null; path: string }): string {
  return doc.title || basename(doc.path).replace(/\.md$/i, "");
}

export function truncateMiddle(value: string, max = 56): string {
  if (value.length <= max) {
    return value;
  }
  const left = Math.max(8, Math.floor((max - 3) * 0.55));
  const right = Math.max(8, max - 3 - left);
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}
