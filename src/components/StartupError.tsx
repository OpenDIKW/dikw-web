import { PlugZap } from "lucide-react";
import { useEffect } from "react";
import {
  isLocale,
  isThemePreference,
  localeStorageKey,
  resolveTheme,
  themeStorageKey,
  translations,
} from "../i18n";
import { Button } from "@opendikw/web-ui/controls";
import { EmptyState } from "@opendikw/web-ui/controls";

/**
 * Rendered instead of the app when the boot probe can't tell whether auth mode
 * is on (issue #200): the app must not start as auth-off on a guess.
 */
export function StartupError() {
  const stored = localStorage.getItem(localeStorageKey);
  const locale = isLocale(stored) ? stored : "en";
  const copy = translations[locale].account;

  useEffect(() => {
    // The app never mounted, so nothing else has applied the theme tokens.
    const preference = localStorage.getItem(themeStorageKey);
    const theme = resolveTheme(isThemePreference(preference) ? preference : "system");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <main className="startup-error">
      <EmptyState icon={PlugZap} title={copy.unreachable} detail={copy.unreachableDetail} />
      <Button variant="secondary" onClick={() => window.location.reload()}>
        {copy.retry}
      </Button>
    </main>
  );
}
