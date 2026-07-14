// Self-contained CSS for the Settings surfaces (task 4c), emitted as a <style> by `SettingsStyles`
// (no build-time CSS pipeline yet — same approach as the permission surfaces). Namespaced under
// `.uts-*`, driven by CSS custom properties so a real design system can restyle later. Quality floor
// baked in: visible focus, WCAG-AA contrast in light AND dark mode, `prefers-reduced-motion` honored.
export const SETTINGS_STYLE_ID = 'undertone-settings-styles';

export const SETTINGS_CSS = `
.uts-root {
  --uts-bg: #ffffff;
  --uts-panel: #f7f7f9;
  --uts-fg: #1a1a1f;
  --uts-muted: #55555f;
  --uts-accent: #1d4ed8;
  --uts-accent-fg: #ffffff;
  --uts-border: #d4d4dc;
  --uts-danger: #b42318;
  --uts-danger-bg: #fef3f2;
  --uts-ok: #027a48;
  color: var(--uts-fg);
  background: var(--uts-bg);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  .uts-root {
    --uts-bg: #131318;
    --uts-panel: #1c1c22;
    --uts-fg: #f4f4f6;
    --uts-muted: #b0b0ba;
    --uts-accent: #7aa2ff;
    --uts-accent-fg: #10131a;
    --uts-border: #3a3a44;
    --uts-danger: #ff9b8f;
    --uts-danger-bg: #2a1614;
    --uts-ok: #6ee7b7;
  }
}
.uts-section {
  background: var(--uts-panel);
  border: 1px solid var(--uts-border);
  border-radius: 12px;
  padding: 20px;
  margin: 0 0 16px;
}
.uts-section-title { font-size: 1.05rem; font-weight: 650; margin: 0 0 4px; }
.uts-section-desc { color: var(--uts-muted); margin: 0 0 16px; font-size: 0.9rem; }
.uts-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 8px 0; }
.uts-row + .uts-row { border-top: 1px solid var(--uts-border); }
.uts-row-main { flex: 1; min-width: 0; }
.uts-row-label { font-weight: 600; margin: 0 0 2px; }
.uts-row-hint { color: var(--uts-muted); font-size: 0.85rem; margin: 0; }
.uts-kbd {
  display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 2px 8px; border: 1px solid var(--uts-border); border-bottom-width: 2px;
  border-radius: 6px; background: var(--uts-bg); font-size: 0.9rem; min-width: 40px; text-align: center;
}
.uts-btn {
  font: inherit; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--uts-border);
  background: var(--uts-bg); color: var(--uts-fg); cursor: pointer;
}
.uts-btn-primary { background: var(--uts-accent); color: var(--uts-accent-fg); border-color: transparent; }
.uts-btn-danger { color: var(--uts-danger); }
.uts-btn:disabled { opacity: 0.55; cursor: default; }
.uts-btn:focus-visible, .uts-input:focus-visible, .uts-switch:focus-visible + .uts-switch-track {
  outline: 3px solid var(--uts-accent); outline-offset: 2px;
}
.uts-btn-recording { border-color: var(--uts-accent); box-shadow: 0 0 0 2px var(--uts-accent); }
.uts-input {
  font: inherit; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--uts-border);
  background: var(--uts-bg); color: var(--uts-fg); width: 100%; box-sizing: border-box;
}
.uts-error {
  color: var(--uts-danger); background: var(--uts-danger-bg); border: 1px solid var(--uts-danger);
  border-radius: 8px; padding: 8px 12px; margin: 8px 0 0; font-size: 0.88rem;
}
.uts-hint { color: var(--uts-muted); font-size: 0.85rem; margin: 6px 0 0; }
.uts-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 4px; }

/* Toggle switch — a styled checkbox; the real input stays in the DOM for a11y + keyboard. */
.uts-switch-wrap { display: inline-flex; align-items: center; }
.uts-switch { position: absolute; opacity: 0; width: 40px; height: 24px; margin: 0; cursor: pointer; }
.uts-switch-track {
  width: 40px; height: 24px; border-radius: 999px; background: var(--uts-border);
  position: relative; transition: background 0.15s ease; flex: none;
}
.uts-switch-track::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
  border-radius: 50%; background: #fff; transition: transform 0.15s ease;
}
.uts-switch:checked + .uts-switch-track { background: var(--uts-accent); }
.uts-switch:checked + .uts-switch-track::after { transform: translateX(16px); }

/* Tag input for soundsLike. */
.uts-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; border: 1px solid var(--uts-border);
  border-radius: 8px; background: var(--uts-bg); }
.uts-tag { display: inline-flex; align-items: center; gap: 4px; background: var(--uts-panel);
  border: 1px solid var(--uts-border); border-radius: 6px; padding: 2px 6px; font-size: 0.85rem; }
.uts-tag-remove { border: none; background: none; cursor: pointer; color: var(--uts-muted);
  font-size: 1rem; line-height: 1; padding: 0 2px; }
.uts-tag-input { border: none; outline: none; background: none; color: var(--uts-fg); font: inherit;
  flex: 1; min-width: 80px; }
.uts-entry-list { list-style: none; margin: 0; padding: 0; }
.uts-entry { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 10px 0; }
.uts-entry + .uts-entry { border-top: 1px solid var(--uts-border); }
.uts-entry-phrase { font-weight: 600; }
.uts-entry-sounds { color: var(--uts-muted); font-size: 0.85rem; margin: 2px 0 0; }
.uts-empty { color: var(--uts-muted); font-style: italic; padding: 12px 0; }
.uts-readonly { color: var(--uts-muted); }

.uts-spinner {
  display: inline-block; width: 14px; height: 14px; border: 2px solid var(--uts-border);
  border-top-color: var(--uts-accent); border-radius: 50%; animation: uts-spin 0.8s linear infinite;
  vertical-align: -2px;
}
@keyframes uts-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .uts-spinner { animation: none; }
  .uts-switch-track, .uts-switch-track::after { transition: none; }
  .uts-root *, .uts-root *::before, .uts-root *::after {
    animation-duration: 0.001ms !important; transition-duration: 0.001ms !important;
  }
}
`;
