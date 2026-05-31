import type { Locale } from "../i18n";

export type LocalizedText = Record<Locale, string>;

export interface Branding {
  name: LocalizedText;
}

export const defaultBranding: Branding = {
  name: { en: "OpenDIKW", "zh-CN": "OpenDIKW" }
};

const LOCALES: Locale[] = ["en", "zh-CN"];

// A bare string applies to every locale; an object overrides per locale and
// falls back to the default for any missing or non-string entry.
function resolveLocalized(raw: unknown, fallback: LocalizedText): LocalizedText {
  if (typeof raw === "string" && raw.length > 0) {
    return { en: raw, "zh-CN": raw };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const out = { ...fallback };
    for (const loc of LOCALES) {
      const value = obj[loc];
      if (typeof value === "string" && value.length > 0) {
        out[loc] = value;
      }
    }
    return out;
  }
  return fallback;
}

// Merge an unknown, possibly-partial external config onto the built-in defaults.
export function resolveBranding(raw: unknown): Branding {
  const brand = raw && typeof raw === "object" ? (raw as Record<string, unknown>).brand : undefined;
  const name = brand && typeof brand === "object" ? (brand as Record<string, unknown>).name : undefined;
  return { name: resolveLocalized(name, defaultBranding.name) };
}

// Runtime branding override: served as a static asset, fetched once at startup.
// A missing, unreachable, or malformed config.json silently falls back to the
// default OpenDIKW branding so the app always renders.
export async function loadBranding(): Promise<Branding> {
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
