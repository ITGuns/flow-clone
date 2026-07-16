// Self-contained CSS for the history view, emitted as a <style> element (no build-time CSS pipeline
// yet — same approach as the permission surfaces). Namespaced under `.uth-*`, driven by CSS custom
// properties so a real design system can restyle later without touching components. Quality floor
// (guide §7): visible focus, WCAG-AA contrast in light AND dark, `prefers-reduced-motion` honored.
export const HISTORY_STYLE_ID = 'undertone-history-styles';

export const HISTORY_CSS = `
.uth-root {
  --uth-bg: #ffffff;
  --uth-surface: #f7f7f9;
  --uth-fg: #1a1a1f;
  --uth-muted: #55555f;
  --uth-accent: #1d4ed8;
  --uth-accent-fg: #ffffff;
  --uth-border: #d4d4dc;
  --uth-danger: #b42318;
  --uth-danger-fg: #ffffff;
  --uth-badge-bg: #e7ecfb;
  --uth-badge-fg: #23407a;
  color: var(--uth-fg);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.5;
  max-width: 720px;
}
@media (prefers-color-scheme: dark) {
  .uth-root {
    --uth-bg: #16161b;
    --uth-surface: #1f1f26;
    --uth-fg: #f4f4f6;
    --uth-muted: #b0b0ba;
    --uth-accent: #7aa2ff;
    --uth-accent-fg: #10131a;
    --uth-border: #3a3a44;
    --uth-danger: #ff9b8f;
    --uth-danger-fg: #10131a;
    --uth-badge-bg: #26304a;
    --uth-badge-fg: #b9caf5;
  }
}
.uth-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.uth-title { font-size: 1.25rem; font-weight: 650; margin: 0; flex: 1 1 auto; }
.uth-search-label { display: block; font-weight: 600; margin: 0 0 4px; }
.uth-search-wrap { flex: 1 1 240px; min-width: 0; }
.uth-search {
  font: inherit;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--uth-border);
  background: var(--uth-bg);
  color: var(--uth-fg);
}
.uth-search::placeholder { color: var(--uth-muted); }
.uth-search:focus-visible { outline: 3px solid var(--uth-accent); outline-offset: 2px; }
.uth-hint { color: var(--uth-muted); font-size: 0.85rem; margin: 4px 0 0; }

.uth-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.uth-row {
  background: var(--uth-surface);
  border: 1px solid var(--uth-border);
  border-radius: 10px;
  padding: 12px 14px;
}
.uth-text { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.uth-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: var(--uth-muted); font-size: 0.85rem; }
.uth-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--uth-badge-bg);
  color: var(--uth-badge-fg);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}
.uth-meta-spacer { flex: 1 1 auto; }

.uth-btn {
  font: inherit;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--uth-border);
  background: var(--uth-bg);
  color: var(--uth-fg);
  cursor: pointer;
}
.uth-btn:disabled { opacity: 0.6; cursor: default; }
.uth-btn:focus-visible { outline: 3px solid var(--uth-accent); outline-offset: 2px; }
.uth-btn-danger { border-color: transparent; background: var(--uth-danger); color: var(--uth-danger-fg); }
.uth-btn-ghost { border-color: transparent; background: transparent; color: var(--uth-accent); }
.uth-btn-sm { padding: 4px 10px; font-size: 0.85rem; }

.uth-confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.uth-confirm-q { color: var(--uth-fg); font-size: 0.85rem; }

.uth-clearall { border-top: 1px solid var(--uth-border); margin-top: 16px; padding-top: 16px; }
.uth-clearall-panel { background: var(--uth-surface); border: 1px solid var(--uth-border); border-radius: 10px; padding: 14px; }
.uth-clearall-panel p { margin: 0 0 8px; }
.uth-clearall-input {
  font: inherit; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--uth-border); background: var(--uth-bg); color: var(--uth-fg);
}
.uth-clearall-input:focus-visible { outline: 3px solid var(--uth-accent); outline-offset: 2px; }

.uth-empty, .uth-loading, .uth-error { padding: 32px 16px; text-align: center; color: var(--uth-muted); }
.uth-empty-title { color: var(--uth-fg); font-weight: 600; margin: 0 0 4px; }
.uth-status-danger { color: var(--uth-danger); font-weight: 600; }
.uth-error { color: var(--uth-danger); }
.uth-more { display: flex; justify-content: center; margin-top: 12px; }

.uth-spinner {
  display: inline-block; width: 14px; height: 14px; margin-right: 8px;
  border: 2px solid var(--uth-border); border-top-color: var(--uth-accent);
  border-radius: 50%; animation: uth-spin 0.8s linear infinite; vertical-align: -2px;
}
@keyframes uth-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .uth-spinner { animation: none; }
  .uth-root *, .uth-root *::before, .uth-root *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
`;
