#!/usr/bin/env node
// Live smoke test for the sidecar's web tools. Reads .env.local,
// then hits Brave Search or Jina Reader directly. Mirrors the tool
// implementations in server/agent/tools.ts so that ts-node/tsx is not
// required to run this script.
//
// Usage (PowerShell or bash):
//   node scripts/verify-web-tools.mjs search "what is RAG"
//   node scripts/verify-web-tools.mjs fetch https://example.com
//
// Output may contain real responses from external APIs. Do not commit
// the output, paste it into shared chats, or attach it to screenshots.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const WEB_FETCH_MAX_CHARS = 50_000;
const WEB_SEARCH_DESC_MAX = 500;
const TIMEOUT_MS = 15_000;

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || (subcommand !== "search" && subcommand !== "fetch")) {
    console.error("usage: node scripts/verify-web-tools.mjs <search|fetch> <query|url>");
    process.exit(2);
  }
  const env = await loadEnv();
  if (subcommand === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      console.error("usage: node scripts/verify-web-tools.mjs search <query>");
      process.exit(2);
    }
    const apiKey = env.DIKW_AGENT_TAVILY_API_KEY;
    if (!apiKey) {
      console.error("DIKW_AGENT_TAVILY_API_KEY missing in .env.local");
      process.exit(1);
    }
    const result = await tavilySearch(apiKey, query, 5);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const url = (rest[0] ?? "").trim();
  if (!url) {
    console.error("usage: node scripts/verify-web-tools.mjs fetch <url>");
    process.exit(2);
  }
  const apiKey = env.DIKW_AGENT_JINA_API_KEY;
  if (!apiKey) {
    console.error("DIKW_AGENT_JINA_API_KEY missing in .env.local");
    process.exit(1);
  }
  const result = await jinaFetch(apiKey, url);
  console.log(JSON.stringify(result, null, 2));
}

async function loadEnv() {
  try {
    const text = await readFile(join(process.cwd(), ".env.local"), "utf8");
    return parseEnv(text);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function tavilySearch(apiKey, q, count) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: apiKey, query: q, max_results: count }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`tavily ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  const results = (Array.isArray(body?.results) ? body.results : []).slice(0, count).map((item) => {
    const content = typeof item.content === "string" ? item.content : "";
    return {
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : "",
      description:
        content.length > WEB_SEARCH_DESC_MAX
          ? content.slice(0, WEB_SEARCH_DESC_MAX - 1) + "…"
          : content,
    };
  });
  return { query: q, results };
}

// Retained; not exposed via the script CLI. Use Tavily as the live web_search probe.
// eslint-disable-next-line no-unused-vars -- retained for provider rotation; intentionally not wired into the CLI
async function braveSearch(apiKey, q, count) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", String(count));
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`brave ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  const results = (body?.web?.results ?? []).slice(0, count).map((item) => {
    const description = typeof item.description === "string" ? item.description : "";
    return {
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : "",
      description:
        description.length > WEB_SEARCH_DESC_MAX
          ? description.slice(0, WEB_SEARCH_DESC_MAX - 1) + "…"
          : description,
    };
  });
  return { query: q, results };
}

async function jinaFetch(apiKey, rawUrl) {
  const safeUrl = validateHttpUrl(rawUrl);
  const endpoint = `https://r.jina.ai/${encodeURIComponent(safeUrl)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "text/plain",
      Authorization: `Bearer ${apiKey}`,
      "X-Return-Format": "markdown",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`jina ${response.status}: ${await response.text()}`);
  }
  const text = await response.text();
  const truncated = text.length > WEB_FETCH_MAX_CHARS;
  return {
    url: safeUrl,
    content: truncated ? text.slice(0, WEB_FETCH_MAX_CHARS) : text,
    truncated,
  };
}

function validateHttpUrl(raw) {
  if (typeof raw !== "string" || !raw) {
    throw new Error("url is required");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("url is not a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("url must not contain embedded credentials");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^(127|10|0)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host === "::"
  ) {
    throw new Error("url targets a private, loopback, or link-local host");
  }
  parsed.hash = "";
  return parsed.toString();
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
