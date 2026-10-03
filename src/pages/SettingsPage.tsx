import { useEffect, useState } from "react";
import { Check, Globe2, MonitorCog, PlugZap, UserRound } from "lucide-react";
import { Button } from "@opendikw/web-ui/controls";
import { Field } from "@opendikw/web-ui/controls";
import { SegmentedControl } from "@opendikw/web-ui/controls";
import type { Locale, ResolvedTheme, ThemePreference } from "../i18n";
import { translations } from "../i18n";
import { defaultServerUrl } from "../config/connection";
import type { AuthRole, AuthUser } from "@opendikw/web-ui/auth";

interface SettingsPageProps {
  locale: Locale;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  serverUrl: string;
  token: string;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemePreference) => void;
  /** Commit the connection (App persists it to localStorage). */
  onSaveConnection: (serverUrl: string, token: string) => void;
  /** Reset the connection to its default URL + empty token, immediately. */
  onClearConnection: () => void;
  /**
   * Auth mode (issue #200): the server owns the core connection, so the
   * Server URL / Token form is replaced by the signed-in account + Sign out.
   */
  account?: { user: AuthUser; role: AuthRole };
}

export function SettingsPage({
  locale,
  theme,
  resolvedTheme,
  serverUrl,
  token,
  onLocaleChange,
  onThemeChange,
  onSaveConnection,
  onClearConnection,
  account,
}: SettingsPageProps) {
  const copy = translations[locale].settings;
  const accountCopy = translations[locale].account;

  // The committed connection (props) is the source of truth; these hold the
  // pending edit so Server URL / Token only take effect on an explicit Save.
  const [draftUrl, setDraftUrl] = useState(serverUrl);
  const [draftToken, setDraftToken] = useState(token);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = draftUrl !== serverUrl || draftToken !== token;

  // The inline "Saved" confirmation is transient — fade it after a beat.
  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 2400);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  function handleSave() {
    // A blank URL would leave the client pointing nowhere; fall back to the
    // documented default rather than persist an empty one. Trim the token too —
    // a copy-pasted trailing space/newline would otherwise corrupt the Bearer
    // header into a 401. Mirror both back into the draft so the form reads clean
    // (not dirty) right after the commit.
    const url = draftUrl.trim() || defaultServerUrl;
    const tok = draftToken.trim();
    setDraftUrl(url);
    setDraftToken(tok);
    onSaveConnection(url, tok);
    setJustSaved(true);
  }

  function handleClear() {
    // Immediate: reset the live connection to defaults; the draft follows so the
    // panel reads clean (not as a pending edit).
    setDraftUrl(defaultServerUrl);
    setDraftToken("");
    setJustSaved(false);
    onClearConnection();
  }

  return (
    <div className="page-stack settings-page">
      <header className="page-header" data-testid="page-header">
        <div>
          <h1>{copy.title}</h1>
          <p className="page-header__description">{copy.description}</p>
        </div>
      </header>

      <section className="settings-grid">
        {account ? (
          <article className="panel settings-panel">
            <div className="settings-panel__header">
              <UserRound size={18} aria-hidden="true" />
              <div>
                <h2>{accountCopy.title}</h2>
                <p>{accountCopy.detail}</p>
              </div>
            </div>
            <dl className="compact-dl">
              {account.user.name ? (
                <div>
                  <dt>{accountCopy.name}</dt>
                  <dd>{account.user.name}</dd>
                </div>
              ) : null}
              {account.user.email ? (
                <div>
                  <dt>{accountCopy.email}</dt>
                  <dd>{account.user.email}</dd>
                </div>
              ) : null}
              <div>
                <dt>{accountCopy.role}</dt>
                <dd>{accountCopy.roles[account.role]}</dd>
              </div>
            </dl>
            {/* A plain form POST: the server clears the session and redirects to
                the IdP's end-session endpoint; the browser sends Origin. */}
            <form className="settings-actions" method="post" action="/web/auth/logout">
              <span />
              <Button type="submit" variant="secondary">
                {accountCopy.signOut}
              </Button>
            </form>
          </article>
        ) : (
          <article className="panel settings-panel">
            <div className="settings-panel__header">
              <PlugZap size={18} aria-hidden="true" />
              <div>
                <h2>{copy.connectionTitle}</h2>
              </div>
            </div>
            <Field label={copy.serverUrl}>
              <input
                value={draftUrl}
                onChange={(event) => {
                  setDraftUrl(event.target.value);
                  setJustSaved(false);
                }}
                placeholder={copy.serverPlaceholder}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field label={copy.token}>
              <input
                value={draftToken}
                onChange={(event) => {
                  setDraftToken(event.target.value);
                  setJustSaved(false);
                }}
                placeholder={copy.tokenPlaceholder}
                type="password"
                autoComplete="off"
              />
            </Field>
            <div className="settings-actions">
              <span className="settings-actions__status" aria-live="polite">
                {dirty ? (
                  <span className="settings-actions__hint">
                    <span className="settings-actions__dot" aria-hidden="true" />
                    {copy.unsavedChanges}
                  </span>
                ) : justSaved ? (
                  <span className="settings-actions__saved">
                    <Check size={14} aria-hidden="true" />
                    {copy.saved}
                  </span>
                ) : null}
              </span>
              <div className="settings-actions__buttons">
                <Button variant="secondary" onClick={handleClear}>
                  {copy.clearConnection}
                </Button>
                <Button onClick={handleSave} disabled={!dirty}>
                  {copy.save}
                </Button>
              </div>
            </div>
          </article>
        )}

        <article className="panel settings-panel">
          <div className="settings-panel__header">
            <MonitorCog size={18} aria-hidden="true" />
            <div>
              <h2>{copy.appearanceTitle}</h2>
              <p>{copy.appearanceDetail}</p>
            </div>
          </div>
          <SegmentedControl
            settings
            ariaLabel={copy.appearanceTitle}
            value={theme}
            onChange={onThemeChange}
            options={[
              { value: "system", label: copy.system },
              { value: "light", label: copy.light },
              { value: "dark", label: copy.dark },
            ]}
          />
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
          <SegmentedControl
            settings
            ariaLabel={copy.languageTitle}
            value={locale}
            onChange={onLocaleChange}
            options={[
              { value: "en", label: copy.english },
              { value: "zh-CN", label: copy.chinese },
            ]}
          />
        </article>
      </section>
    </div>
  );
}
