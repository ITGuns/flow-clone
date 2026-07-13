import type { ReactElement } from 'react';

/** Placeholder renderer root. Real HUD states (listening/thinking/done) arrive in task 4a. */
export function App(): ReactElement {
  return (
    <main className="undertone-hud">
      <h1>Undertone</h1>
    </main>
  );
}
