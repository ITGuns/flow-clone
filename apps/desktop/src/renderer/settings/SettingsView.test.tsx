// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { SettingsView } from './SettingsView';
import { FakeSettingsBridge } from './fake-settings-bridge';
import { FakeDictionaryApi } from './fake-dictionary-api';
import { mount, query, flush } from '../permissions/dom-harness';

async function toggle(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLInputElement).click();
  });
  await flush();
}

describe('SettingsView — telemetry round-trips through the bridge', () => {
  it('loads settings, then opting out persists via the bridge and re-renders unchecked', async () => {
    const bridge = new FakeSettingsBridge({ telemetryEnabled: true });
    const view = await mount(
      <SettingsView
        bridge={bridge}
        dictionaryApi={new FakeDictionaryApi()}
        isHotkeySupported={() => true}
      />,
    );
    await flush(); // resolve bridge.get()

    const switches = view.container.querySelectorAll<HTMLInputElement>('input[role="switch"]');
    const telemetry = switches[0]!;
    expect(telemetry.checked).toBe(true);

    await toggle(telemetry);

    // The patch went through the bridge...
    expect(bridge.patches).toContainEqual({ telemetryEnabled: false });
    expect((await bridge.get()).telemetryEnabled).toBe(false);
    // ...and the bridge's change push flowed back into the UI.
    const after = view.container.querySelectorAll<HTMLInputElement>('input[role="switch"]');
    expect(after[0]!.checked).toBe(false);
    await view.unmount();
  });

  it('persists a recorded hotkey through the bridge', async () => {
    const bridge = new FakeSettingsBridge({ hotkey: 'F8' });
    const view = await mount(
      <SettingsView
        bridge={bridge}
        dictionaryApi={new FakeDictionaryApi()}
        isHotkeySupported={() => true}
      />,
    );
    await flush();

    // Enter recording and capture F9.
    const recordBtn = Array.from(view.container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '') === 'Record',
    )!;
    await act(async () => {
      recordBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await act(async () => {
      recordBtn.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F9' }),
      );
    });
    await flush();

    expect(bridge.patches).toContainEqual({ hotkey: 'F9' });
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('F9');
    await view.unmount();
  });

  it('reflects an out-of-band settings change pushed from main', async () => {
    const bridge = new FakeSettingsBridge({ hotkey: 'F8' });
    const view = await mount(
      <SettingsView
        bridge={bridge}
        dictionaryApi={new FakeDictionaryApi()}
        isHotkeySupported={() => true}
      />,
    );
    await flush();
    await act(async () => {
      bridge.pushChange({ hotkey: 'Alt+Space' });
    });
    await flush();
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('Alt+Space');
    await view.unmount();
  });
});
