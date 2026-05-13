import { Globe2, MonitorCog, PlugZap } from "lucide-react";
import type { Locale, ResolvedTheme, ThemePreference } from "../i18n";
import { translations } from "../i18n";

interface SettingsPageProps {
  locale: Locale;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  serverUrl: string;
  token: string;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemePreference) => void;
  onServerUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onClearConnection: () => void;
}

export function SettingsPage({
  locale,
  theme,
  resolvedTheme,
  serverUrl,
  token,
  onLocaleChange,
  onThemeChange,
  onServerUrlChange,
  onTokenChange,
  onClearConnection
}: SettingsPageProps) {
  const copy = translations[locale].settings;

  return (
    <div className="page-stack settings-page">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="page-header__description">{copy.description}</p>
        </div>
      </header>

      <section className="settings-grid">
        <article className="panel settings-panel">
          <div className="settings-panel__header">
            <PlugZap size={18} aria-hidden="true" />
            <div>
              <h2>{copy.connectionTitle}</h2>
              <p>{copy.connectionDetail}</p>
            </div>
          </div>
          <label className="field">
            <span>{copy.serverUrl}</span>
            <input
              aria-label="Server URL"
              value={serverUrl}
              onChange={(event) => onServerUrlChange(event.target.value)}
              placeholder={copy.serverPlaceholder}
            />
          </label>
          <label className="field">
            <span>{copy.token}</span>
            <input
              aria-label="Token"
              value={token}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder={copy.tokenPlaceholder}
              type="password"
            />
          </label>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onClearConnection}>
              {copy.clearConnection}
            </button>
          </div>
        </article>

        <article className="panel settings-panel">
          <div className="settings-panel__header">
            <MonitorCog size={18} aria-hidden="true" />
            <div>
              <h2>{copy.appearanceTitle}</h2>
              <p>{copy.appearanceDetail}</p>
            </div>
          </div>
          <div className="segmented-control segmented-control--settings" aria-label={copy.appearanceTitle}>
            <button className={theme === "system" ? "is-active" : ""} type="button" onClick={() => onThemeChange("system")}>
              {copy.system}
            </button>
            <button className={theme === "light" ? "is-active" : ""} type="button" onClick={() => onThemeChange("light")}>
              {copy.light}
            </button>
            <button className={theme === "dark" ? "is-active" : ""} type="button" onClick={() => onThemeChange("dark")}>
              {copy.dark}
            </button>
          </div>
          <dl className="compact-dl">
            <div>
              <dt>{copy.currentTheme}</dt>
              <dd>{resolvedTheme}</dd>
            </div>
          </dl>
        </article>

        <article className="panel settings-panel">
          <div className="settings-panel__header">
            <Globe2 size={18} aria-hidden="true" />
            <div>
              <h2>{copy.languageTitle}</h2>
              <p>{copy.languageDetail}</p>
            </div>
          </div>
          <div className="segmented-control segmented-control--settings" aria-label={copy.languageTitle}>
            <button className={locale === "en" ? "is-active" : ""} type="button" onClick={() => onLocaleChange("en")}>
              {copy.english}
            </button>
            <button className={locale === "zh-CN" ? "is-active" : ""} type="button" onClick={() => onLocaleChange("zh-CN")}>
              {copy.chinese}
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
