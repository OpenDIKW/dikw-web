/** Application hooks carry nonsecret metadata, never authentication or endpoints. */
export function applicationHeaders(values: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([name]) =>
        ![
          "accept",
          "content-type",
          "authorization",
          "proxy-authorization",
          "cookie",
          "cookie2",
          "host",
          "origin",
          "x-dikw-core-url",
          "x-dikw-core-token",
          "x-core-url",
          "x-core-token",
        ].includes(name.toLowerCase()),
    ),
  );
}
