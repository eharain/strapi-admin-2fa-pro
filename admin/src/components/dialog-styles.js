/**
 * The sign-in dialog renders on the login page, which is outside the admin
 * app's React tree — there is no theme provider up there to inherit from, and
 * no design-system context. So it brings its own styling, written against
 * Strapi's palette and injected once.
 *
 * Doing it this way also means the dialog does not move when
 * `@strapi/design-system` does, which for the one screen nobody can work
 * around is worth more than looking pixel-identical.
 */
const STYLE_ID = 'two-factor-dialog-styles';

const CSS = `
.t2fa-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(33, 33, 52, 0.55);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;

  --t2fa-surface: #ffffff;
  --t2fa-text: #32324d;
  --t2fa-muted: #666687;
  --t2fa-border: #dcdce4;
  --t2fa-field: #ffffff;
  --t2fa-primary: #4945ff;
  --t2fa-primary-text: #ffffff;
  --t2fa-danger: #d02b20;
  --t2fa-danger-bg: #fcecea;
  --t2fa-code-bg: #f6f6f9;
}

.t2fa-overlay[data-theme="dark"] {
  background: rgba(10, 10, 20, 0.7);
  --t2fa-surface: #212134;
  --t2fa-text: #ffffff;
  --t2fa-muted: #a5a5ba;
  --t2fa-border: #4a4a6a;
  --t2fa-field: #181826;
  --t2fa-primary: #7b79ff;
  --t2fa-primary-text: #ffffff;
  --t2fa-danger: #ee5e52;
  --t2fa-danger-bg: #3a1a18;
  --t2fa-code-bg: #181826;
}

.t2fa-card {
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--t2fa-surface);
  color: var(--t2fa-text);
  border-radius: 4px;
  box-shadow: 0 2px 15px rgba(33, 33, 52, 0.35);
  padding: 32px;
  box-sizing: border-box;
}

.t2fa-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}

.t2fa-lede {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--t2fa-muted);
}

.t2fa-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
}

.t2fa-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font-size: 20px;
  letter-spacing: 4px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--t2fa-text);
  background: var(--t2fa-field);
  border: 1px solid var(--t2fa-border);
  border-radius: 4px;
}

.t2fa-input:focus {
  outline: 2px solid var(--t2fa-primary);
  outline-offset: 1px;
}

.t2fa-input[data-recovery="true"] {
  font-size: 16px;
  letter-spacing: 2px;
}

.t2fa-actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}

.t2fa-button {
  flex: 1;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 4px;
  border: 1px solid var(--t2fa-primary);
  background: var(--t2fa-primary);
  color: var(--t2fa-primary-text);
  cursor: pointer;
}

.t2fa-button[disabled] {
  opacity: 0.6;
  cursor: default;
}

.t2fa-button[data-variant="ghost"] {
  background: transparent;
  color: var(--t2fa-text);
  border-color: var(--t2fa-border);
}

.t2fa-link {
  display: inline-block;
  margin-top: 14px;
  padding: 0;
  font-size: 13px;
  font-family: inherit;
  color: var(--t2fa-primary);
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
}

.t2fa-error {
  margin: 0 0 16px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 4px;
  color: var(--t2fa-danger);
  background: var(--t2fa-danger-bg);
}

.t2fa-qr {
  display: block;
  margin: 0 auto 16px;
  width: 200px;
  height: 200px;
  border-radius: 4px;
  background: #ffffff;
  padding: 8px;
  box-sizing: border-box;
}

.t2fa-secret {
  display: block;
  margin: 0 0 16px;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  letter-spacing: 1px;
  word-break: break-all;
  text-align: center;
  color: var(--t2fa-text);
  background: var(--t2fa-code-bg);
  border-radius: 4px;
}

.t2fa-open-app {
  display: block;
  margin: 0 0 16px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  color: var(--t2fa-primary-text);
  background: var(--t2fa-primary);
  border-radius: 4px;
}

.t2fa-codes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin: 0 0 16px;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  background: var(--t2fa-code-bg);
  border-radius: 4px;
}

.t2fa-steps {
  margin: 0 0 16px;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--t2fa-muted);
}
`;

export const injectDialogStyles = () => {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
};

/** Follow whatever theme the panel is already in, so the dialog is not a flash of white. */
export const resolveTheme = () => {
  let stored = null;
  try {
    stored = window.localStorage.getItem('STRAPI_THEME');
  } catch {
    /* private browsing, blocked storage — fall through to the system preference */
  }

  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
