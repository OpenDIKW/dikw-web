// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildTar } from "./tar.js";
import { readTar } from "./tar-reader.js";
import { streamTar } from "./tar-stream.js";

function fragmented(bytes: Uint8Array): ReadableStream<Uint8Array<ArrayBuffer>> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + 137);
      controller.enqueue(new Uint8Array(bytes.subarray(offset, end)));
      offset = end;
    },
  });
}

describe("streamed USTAR checks", () => {
  it("cancels upstream while the next asset chunk is pending", async () => {
    let cancelled = false;
    let waiting!: () => void;
    const nextRead = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const header = buildTar([{ archivePath: "figure.png", data: new Uint8Array(512) }]).slice(
      0,
      512,
    );
    const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(header));
      },
      pull() {
        waiting();
        return new Promise<void>(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const reader = streamTar(
      input,
      () => true,
      () => false,
      async () => {},
    ).getReader();
    expect((await reader.read()).value).toEqual(header);
    await nextRead;
    await reader.cancel();
    expect(cancelled).toBe(true);
  });
  it("retains selected bytes across fragmented headers, UTF-8 bodies and padding", async () => {
    const source = buildTar([
      { archivePath: "sources/old.md", data: new TextEncoder().encode("old") },
      { archivePath: "sources/fresh.md", data: new TextEncoder().encode("中文".repeat(180)) },
      { archivePath: "sources/figure.png", data: new Uint8Array(1001).fill(73) },
    ]);
    const texts: string[] = [];
    const result = streamTar(
      fragmented(source),
      (path) => path !== "sources/old.md",
      (path) => path.endsWith(".md"),
      async (path, text) => {
        texts.push(`${path}:${text}`);
      },
    );
    const entries = readTar(new Uint8Array(await new Response(result).arrayBuffer()));
    expect(entries.map((entry) => entry.archivePath)).toEqual([
      "sources/fresh.md",
      "sources/figure.png",
    ]);
    expect(entries[1].data).toEqual(new Uint8Array(1001).fill(73));
    expect(texts).toEqual(["sources/old.md:old", `sources/fresh.md:${"中文".repeat(180)}`]);
  });

  it.each(["header", "data", "checksum", "path"])("rejects invalid %s", async (kind) => {
    let bytes = buildTar([
      { archivePath: kind === "path" ? "../escape.md" : "safe.md", data: new Uint8Array(600) },
    ]);
    if (kind === "header") bytes = bytes.subarray(0, 200);
    if (kind === "data") bytes = bytes.subarray(0, 1000);
    if (kind === "checksum") bytes[0] ^= 0xff;
    const stream = streamTar(
      fragmented(bytes),
      () => true,
      () => false,
      async () => {},
    );
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow(/tar/);
  });

  it("propagates an input error after the tar terminator", async () => {
    let sent = false;
    const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (sent) controller.error(new Error("gzip checksum failed"));
        else {
          sent = true;
          controller.enqueue(new Uint8Array(1024));
        }
      },
    });
    const stream = streamTar(
      input,
      () => false,
      () => false,
      async () => {},
    );
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow("gzip checksum failed");
  });
});
