// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { PreferencesPanel } from './PreferencesPanel';
import { DEFAULT_SETTINGS } from '../../settings-schema';
import { mount, query, flush } from '../permissions/dom-harness';

async function toggle(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLInputElement).click();
  });
  await flush();
}

describe('PreferencesPanel', () => {
  it('states the privacy posture in plain language (guide §3)', async () => {
    const view = await mount(<PreferencesPanel settings={DEFAULT_SETTINGS} onChange={() => {}} />);
    expect(view.container.textContent).toContain('never what you say');
    await view.unmount();
  });

  it('reflects telemetry ON by default and emits an opt-OUT patch when toggled off', async () => {
    const onChange = vi.fn();
    const view = await mount(
      <PreferencesPanel
        settings={{ ...DEFAULT_SETTINGS, telemetryEnabled: true }}
        onChange={onChange}
      />,
    );
    const switches = view.container.querySelectorAll<HTMLInputElement>('input[role="switch"]');
    const telemetry = switches[0]!;
    expect(telemetry.checked).toBe(true); // default TRUE
    await toggle(telemetry);
    expect(onChange).toHaveBeenCalledWith({ telemetryEnabled: false });
    await view.unmount();
  });

  it('emits a launchAtLogin patch and notes it applies later', async () => {
    const onChange = vi.fn();
    const view = await mount(<PreferencesPanel settings={DEFAULT_SETTINGS} onChange={onChange} />);
    expect(view.container.textContent).toMatch(/after the next install/i);
    const switches = view.container.querySelectorAll<HTMLInputElement>('input[role="switch"]');
    await toggle(switches[1]!);
    expect(onChange).toHaveBeenCalledWith({ launchAtLogin: true });
    await view.unmount();
  });

  it('shows locale read-only', async () => {
    const view = await mount(
      <PreferencesPanel settings={{ ...DEFAULT_SETTINGS, locale: 'en-US' }} onChange={() => {}} />,
    );
    const readonly = query(view.container, '.uts-readonly');
    expect(readonly.textContent).toBe('en-US');
    await view.unmount();
  });
});
