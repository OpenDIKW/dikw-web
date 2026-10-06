import { readTarHeader, TarReaderError } from "./tar-reader.js";

const BLOCK = 512;

/** Inspect only requested Markdown bodies and stream retained USTAR bytes.
 * Asset data is never collected or copied into an archive-sized buffer. */
export function streamTar(
  input: ReadableStream<Uint8Array<ArrayBuffer>>,
  retain: (path: string) => boolean,
  inspect: (path: string) => boolean,
  onText: (path: string, text: string) => Promise<void>,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const reader = input.getReader();
  async function* chunks(): AsyncGenerator<Uint8Array<ArrayBuffer>, void> {
    let pending = new Uint8Array(0);
    let offset = 0;
    async function next(): Promise<boolean> {
      while (offset === pending.length) {
        const item = await reader.read();
        if (item.done) return false;
        pending = item.value;
        offset = 0;
      }
      return true;
    }
    async function* take(length: number): AsyncGenerator<Uint8Array<ArrayBuffer>> {
      while (length > 0) {
        if (!(await next())) throw new TarReaderError("truncated", "tar entry data truncated");
        const count = Math.min(length, pending.length - offset);
        const part = pending.subarray(offset, offset + count);
        offset += count;
        length -= count;
        yield part;
      }
    }
    try {
      while (await next()) {
        const header = new Uint8Array(BLOCK);
        let position = 0;
        for await (const part of take(BLOCK)) {
          header.set(part, position);
          position += part.length;
        }
        const entry = readTarHeader(header);
        if (!entry) {
          // Consume the gzip trailer too: checksum/format errors after the tar
          // terminator must preserve the existing fail-closed filtering behavior.
          while (!(await reader.read()).done) {
            /* discard trailing tar bytes */
          }
          break;
        }
        const keep = retain(entry.archivePath);
        const decoder = inspect(entry.archivePath) ? new TextDecoder() : null;
        let text = "";
        if (keep) yield header;
        for await (const part of take(entry.size)) {
          if (decoder) text += decoder.decode(part, { stream: true });
          if (keep) yield part;
        }
        if (decoder) await onText(entry.archivePath, text + decoder.decode());
        const padding = (BLOCK - (entry.size % BLOCK)) % BLOCK;
        for await (const part of take(padding)) if (keep) yield part;
      }
      yield new Uint8Array(BLOCK * 2);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const iterator = chunks();
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      // Generator.return queues behind a pending next(). Cancel the upstream
      // read first so a stalled stream can reach the generator's finally block.
      await reader.cancel(reason).catch(() => {});
      await iterator.return(undefined);
      reader.releaseLock();
    },
  });
}
