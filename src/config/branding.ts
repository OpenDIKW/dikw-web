import type { Locale } from "../i18n";

export type LocalizedText = Record<Locale, string>;

export interface Branding {
  name: LocalizedText;
}

export const defaultBranding: Branding = {
  name: { en: "OpenDIKW", "zh-CN": "OpenDIKW" },
};

// Cap the startup config fetch so a stalled /config.json can never block the
// first render — we fall back to the default branding instead.
const BRANDING_FETCH_TIMEOUT_MS = 2000;

// A bare string applies to every locale; an object overrides per locale and
// falls back to the default for any missing or non-string entry. Locales are
// derived from the fallback's own keys so a new `Locale` never needs a second
// edit site here, and every branch returns a fresh object.
function resolveLocalized(raw: unknown, fallback: LocalizedText): LocalizedText {
  const out = { ...fallback };
  if (typeof raw === "string" && raw.length > 0) {
    for (const loc of Object.keys(out) as Locale[]) {
      out[loc] = raw;
    }
    return out;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const loc of Object.keys(out) as Locale[]) {
      const value = obj[loc];
      if (typeof value === "string" && value.length > 0) {
        out[loc] = value;
      }
    }
  }
  return out;
}

// Merge an unknown, possibly-partial external config onto the built-in defaults.
export function resolveBranding(raw: unknown): Branding {
  const brand = raw && typeof raw === "object" ? (raw as Record<string, unknown>).brand : undefined;
  const name =
    brand && typeof brand === "object" ? (brand as Record<string, unknown>).name : undefined;
  return { name: resolveLocalized(name, defaultBranding.name) };
}

async function fetchBranding(): Promise<Branding> {
  try {
    const res = await fetch("/config.json", { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return defaultBranding;
    }
    return resolveBranding((await res.json()) as unknown);
  } catch {
    return defaultBranding;
  }
}

// Runtime branding override: served as a static asset, fetched once at startup.
// A missing, unreachable, malformed, or slow config.json silently falls back to
// the default OpenDIKW branding so the app always renders.
export function loadBranding(): Promise<Branding> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Branding>((resolve) => {
    timer = setTimeout(() => resolve(defaultBranding), BRANDING_FETCH_TIMEOUT_MS);
  });
  return Promise.race([fetchBranding(), timeout]).finally(() => clearTimeout(timer));
}
