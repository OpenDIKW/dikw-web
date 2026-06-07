import { ProxyAgent } from "undici";

const webProxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
const webProxyDispatcher = webProxyUrl ? new ProxyAgent(webProxyUrl) : undefined;

export interface DikwToolsOptions {
  coreUrl: string;
  token?: string;
  braveApiKey?: string;
  jinaApiKey?: string;
  tavilyApiKey?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const WEB_FETCH_MAX_CHARS = 50_000;
export const WEB_FETCH_TEXT_BUDGET = 12_000;
const WEB_SEARCH_DESC_MAX = 500;
const WEB_TOOL_TIMEOUT_MS = 15_000;

const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const JINA_READER_ENDPOINT = "https://r.jina.ai/";

export function validateAndNormalizeHttpUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) {
    throw new Error("url is required");
  }
  let parsed: URL;
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
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error("url targets a private, loopback, or link-local host");
  }
  parsed.hash = "";
  return parsed.toString();
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    return true;
  }
  const ipv6 = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  if (ipv6.includes(":")) {
    if (ipv6 === "::" || ipv6 === "::1") return true;
    const head = ipv6.replace(/^\[|\]$/g, "");
    if (/^fe[89ab]/.test(head)) return true;
    if (/^f[cd]/.test(head)) return true;
    // IPv4-mapped IPv6 (`::ffff:127.0.0.1` or `::ffff:7f00:1`) bypasses dotted-IPv4 checks
    // and gives no legitimate public-host use case — refuse the whole form.
    if (head.startsWith("::ffff:") || head.includes(":ffff:")) return true;
  }
  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, ,] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]), Number(ipv4[4])];
    if (
      [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]), Number(ipv4[4])].some(
        (part) => part < 0 || part > 255,
      )
    ) {
      return true;
    }
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }
  return false;
}

export class CoreToolClient {
  private readonly fetchImpl: typeof fetch;
  private readonly coreUrl: string;
  private readonly token: string;

  constructor(options: DikwToolsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.coreUrl = options.coreUrl.replace(/\/$/, "");
    this.token = options.token ?? "";
  }

  async getJson(path: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(this.url(path, params), { headers: this.headers(false) });
    return readJsonResponse(response);
  }

  async retrieve(q: string, limit: number): Promise<unknown> {
    const response = await this.fetchImpl(this.url("/v1/retrieve"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ q, limit }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const text = await response.text();
    let finalResult: unknown = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line) as {
        type?: string;
        status?: string;
        result?: unknown;
        error?: { message?: string };
      };
      if (event.type === "final") {
        if (event.status === "succeeded") {
          finalResult = event.result;
        } else {
          throw new Error(event.error?.message ?? `retrieve ${event.status ?? "failed"}`);
        }
      }
    }
    return finalResult ?? { chunks: [], page_refs: [] };
  }

  private url(path: string, params?: Record<string, unknown>): string {
    const url = new URL(path, this.coreUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private headers(hasJsonBody: boolean): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json, application/x-ndjson" };
    if (hasJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

export interface WebSearchToolResult {
  query: string;
  results: WebSearchResult[];
}

export interface WebFetchToolResult {
  url: string;
  title?: string;
  content: string;
  truncated: boolean;
}

export class WebToolClient {
  private readonly fetchImpl: typeof fetch;
  private readonly braveApiKey?: string;
  private readonly jinaApiKey?: string;
  private readonly tavilyApiKey?: string;
  private readonly userSignal?: AbortSignal;

  constructor(options: DikwToolsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.braveApiKey = options.braveApiKey;
    this.jinaApiKey = options.jinaApiKey;
    this.tavilyApiKey = options.tavilyApiKey;
    this.userSignal = options.signal;
  }

  // Retained for re-enabling; not currently registered as an agent tool.
  // Kept under unit test to prevent silent rot.
  async search(q: string, count: number, freshness?: string): Promise<WebSearchToolResult> {
    if (!this.braveApiKey) {
      throw new Error("web_search requires DIKW_AGENT_BRAVE_API_KEY in .env.local");
    }
    const safeCount = Math.max(1, Math.min(10, Math.floor(count)));
    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set("q", q);
    url.searchParams.set("count", String(safeCount));
    if (freshness) {
      url.searchParams.set("freshness", freshness);
    }
    const response = await this.request(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.braveApiKey,
      },
    });
    const body = (await response.json().catch(() => ({}))) as { web?: { results?: unknown } };
    const rawResults = Array.isArray(body?.web?.results) ? body.web.results : [];
    const results: WebSearchResult[] = rawResults
      .filter(isPlainRecord)
      .flatMap((item) => {
        let safeUrl: string;
        try {
          safeUrl = validateAndNormalizeHttpUrl(item.url);
        } catch {
          return [] as WebSearchResult[];
        }
        const description = typeof item.description === "string" ? item.description : "";
        return [
          {
            title: typeof item.title === "string" ? item.title : "",
            url: safeUrl,
            description:
              description.length > WEB_SEARCH_DESC_MAX
                ? description.slice(0, WEB_SEARCH_DESC_MAX - 1) + "…"
                : description,
            ...(typeof item.age === "string" ? { age: item.age } : {}),
          },
        ];
      })
      .slice(0, safeCount);
    return { query: q, results };
  }

  async tavilySearch(q: string, count: number): Promise<WebSearchToolResult> {
    if (!this.tavilyApiKey) {
      throw new Error("web_search requires DIKW_AGENT_TAVILY_API_KEY in .env.local");
    }
    const safeCount = Math.max(1, Math.min(10, Math.floor(count)));
    const response = await this.request(TAVILY_SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ api_key: this.tavilyApiKey, query: q, max_results: safeCount }),
    });
    const body = (await response.json().catch(() => ({}))) as { results?: unknown };
    const rawResults = Array.isArray(body?.results) ? body.results : [];
    const results: WebSearchResult[] = rawResults
      .filter(isPlainRecord)
      .flatMap((item) => {
        let safeUrl: string;
        try {
          safeUrl = validateAndNormalizeHttpUrl(item.url);
        } catch {
          return [] as WebSearchResult[];
        }
        const content = typeof item.content === "string" ? item.content : "";
        return [
          {
            title: typeof item.title === "string" ? item.title : "",
            url: safeUrl,
            description:
              content.length > WEB_SEARCH_DESC_MAX
                ? content.slice(0, WEB_SEARCH_DESC_MAX - 1) + "…"
                : content,
          },
        ];
      })
      .slice(0, safeCount);
    return { query: q, results };
  }

  async fetchPage(rawUrl: unknown, format: "markdown" | "text"): Promise<WebFetchToolResult> {
    if (!this.jinaApiKey) {
      throw new Error("web_fetch requires DIKW_AGENT_JINA_API_KEY in .env.local");
    }
    const safeUrl = validateAndNormalizeHttpUrl(rawUrl);
    const endpoint = `${JINA_READER_ENDPOINT}${encodeURIComponent(safeUrl)}`;
    const response = await this.request(endpoint, {
      headers: {
        Accept: "text/plain",
        Authorization: `Bearer ${this.jinaApiKey}`,
        "X-Return-Format": format,
      },
    });
    const text = await response.text();
    const truncated = text.length > WEB_FETCH_MAX_CHARS;
    const content = truncated ? text.slice(0, WEB_FETCH_MAX_CHARS) : text;
    return { url: safeUrl, content, truncated };
  }

  private async request(
    url: string,
    init: { method?: string; headers: Record<string, string>; body?: BodyInit | null },
  ): Promise<Response> {
    const signals: AbortSignal[] = [AbortSignal.timeout(WEB_TOOL_TIMEOUT_MS)];
    if (this.userSignal) {
      signals.push(this.userSignal);
    }
    const fetchInit: RequestInit & { dispatcher?: unknown } = {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    };
    if (webProxyDispatcher && this.fetchImpl === fetch) {
      fetchInit.dispatcher = webProxyDispatcher;
    }
    const response = await this.fetchImpl(url, fetchInit);
    if (!response.ok) {
      // Drain and drop the body; providers like Tavily echo the request payload
      // (which carries the api key) in error responses, so we never surface it.
      await response.text().catch(() => "");
      throw new Error(`upstream ${response.status}`);
    }
    return response;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
