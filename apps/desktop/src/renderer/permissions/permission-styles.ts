// Minimal, self-contained CSS for the permission surfaces (Phase 2d). Emitted as a <style> element
// by `PermissionStyles` so there is no build-time CSS pipeline yet (guide §7: "No real styling
// system yet — semantic accessible markup, minimal CSS, styleable later"). Everything is namespaced
// under `.utp-*` and driven by CSS custom properties so a real design system can restyle it later
// without touching the components. Quality floor baked in: visible focus, WCAG-AA contrast in light
// AND dark mode, and `prefers-reduced-motion` honored.
export const PERMISSION_STYLE_ID = 'undertone-permission-styles';

export const PERMISSION_CSS = `
.utp-root {
  --utp-bg: #ffffff;
  --utp-fg: #1a1a1f;
  --utp-muted: #55555f;
  --utp-accent: #1d4ed8;
  --utp-accent-fg: #ffffff;
  --utp-border: #d4d4dc;
  --utp-danger: #b42318;
  --utp-ok: #027a48;
  color: var(--utp-fg);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  .utp-root {
    --utp-bg: #1a1a1f;
    --utp-fg: #f4f4f6;
    --utp-muted: #b0b0ba;
    --utp-accent: #7aa2ff;
    --utp-accent-fg: #10131a;
    --utp-border: #3a3a44;
    --utp-danger: #ff9b8f;
    --utp-ok: #6ee7b7;
  }
}
.utp-card {
  background: var(--utp-bg);
  border: 1px solid var(--utp-border);
  border-radius: 12px;
  padding: 24px;
  max-width: 420px;
}
.utp-title { font-size: 1.25rem; font-weight: 650; margin: 0 0 8px; }
.utp-why { color: var(--utp-fg); margin: 0 0 16px; }
.utp-lead { color: var(--utp-fg); margin: 0 0 16px; }
.utp-legend { font-weight: 600; margin: 12px 0 4px; }
.utp-list { margin: 0 0 12px; padding-left: 1.2em; color: var(--utp-muted); }
.utp-list li { margin: 2px 0; }
.utp-steps { margin: 0 0 16px; padding-left: 1.2em; }
.utp-steps li { margin: 4px 0; }
.utp-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
.utp-btn {
  font: inherit;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--utp-border);
  background: var(--utp-bg);
  color: var(--utp-fg);
  cursor: pointer;
}
.utp-btn-primary { background: var(--utp-accent); color: var(--utp-accent-fg); border-color: transparent; }
.utp-btn:disabled { opacity: 0.6; cursor: default; }
.utp-btn:focus-visible { outline: 3px solid var(--utp-accent); outline-offset: 2px; }
.utp-status-ok { color: var(--utp-ok); font-weight: 600; }
.utp-status-danger { color: var(--utp-danger); font-weight: 600; }
.utp-spinner {
  display: inline-block; width: 14px; height: 14px; margin-right: 8px;
  border: 2px solid var(--utp-border); border-top-color: var(--utp-accent);
  border-radius: 50%; animation: utp-spin 0.8s linear infinite; vertical-align: -2px;
}
@keyframes utp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .utp-spinner { animation: none; }
  .utp-root *, .utp-root *::before, .utp-root *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
`;
