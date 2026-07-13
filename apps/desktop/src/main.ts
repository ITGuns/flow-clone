// Electron main process. Creates a hidden, non-activating window shell; the HUD, hotkey, and
// injection mechanics land in Phase 4 (task 4a) behind the CONTRACTS.md §2.3 native interfaces.
import { app, BrowserWindow } from 'electron';
import type { SessionId } from '@undertone/shared';

// Client-generated per-process id; real per-WS-connection SessionIds are minted in Phase 1.
const bootSessionId: SessionId = crypto.randomUUID();

function createHiddenWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false, // never steals focus; HUD visibility is driven by the session state machine
    width: 380,
    height: 220,
    frame: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}

app
  .whenReady()
  .then(() => {
    const win = createHiddenWindow();
    console.log(`[undertone] main ready — boot session ${bootSessionId}, window ${win.id}`);
  })
  .catch((err: unknown) => {
    console.error('[undertone] failed to initialize main process', err);
  });

app.on('window-all-closed', () => {
  // Undertone is a background/tray app; closing windows does not quit on macOS.
  if (process.platform !== 'darwin') app.quit();
});
