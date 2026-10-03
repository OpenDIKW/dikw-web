export class InvalidNdjsonError extends Error {
  constructor(line: string) {
    super(`Invalid NDJSON line: ${line.slice(0, 160)}`);
    this.name = "InvalidNdjsonError";
  }
}

export interface NdjsonParseResult {
  events: unknown[];
  tail: string;
}

export function parseNdjsonBuffer(buffer: string): NdjsonParseResult {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const tail = parts.pop() ?? "";
  const events: unknown[] = [];

  for (const part of parts) {
    const line = part.trim();
    if (!line) {
      continue;
    }
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new InvalidNdjsonError(line);
    }
  }

  return { events, tail };
}

export async function* decodeNdjsonStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value, { stream: true });
      const parsed = parseNdjsonBuffer(tail + text);
      tail = parsed.tail;
      for (const event of parsed.events) {
        yield event;
      }
    }

    const finalText = decoder.decode();
    const remainder = (tail + finalText).trim();
    if (remainder) {
      try {
        yield JSON.parse(remainder);
      } catch {
        throw new InvalidNdjsonError(remainder);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
