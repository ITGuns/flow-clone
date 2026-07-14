// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { HotkeyRecorder } from './HotkeyRecorder';
import { mount, click, buttonByText, query } from '../permissions/dom-harness';

/** Dispatch a keydown on an element and flush React work. */
async function press(el: Element, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('HotkeyRecorder — capture', () => {
  it('shows the current accelerator', async () => {
    const view = await mount(
      <HotkeyRecorder value="F8" onChange={() => {}} isSupported={() => true} />,
    );
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('F8');
    await view.unmount();
  });

  it('records a supported key and reports it via onChange', async () => {
    const onChange = vi.fn();
    const view = await mount(
      <HotkeyRecorder value="F8" onChange={onChange} isSupported={() => true} />,
    );
    const record = buttonByText(view.container, 'Record');
    await click(record);
    // "Press a key…" placeholder is shown while recording.
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('Press a key…');
    await press(record, { key: 'F9' });
    expect(onChange).toHaveBeenCalledWith('F9');
    await view.unmount();
  });

  it('ignores a modifiers-only press and keeps recording', async () => {
    const onChange = vi.fn();
    const view = await mount(
      <HotkeyRecorder value="F8" onChange={onChange} isSupported={() => true} />,
    );
    const record = buttonByText(view.container, 'Record');
    await click(record);
    await press(record, { key: 'Shift', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    // still recording
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('Press a key…');
    await view.unmount();
  });

  it('cancels recording on Escape without changing the value', async () => {
    const onChange = vi.fn();
    const view = await mount(
      <HotkeyRecorder value="F8" onChange={onChange} isSupported={() => true} />,
    );
    await click(buttonByText(view.container, 'Record'));
    await press(buttonByText(view.container, 'Recording'), { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('F8');
    await view.unmount();
  });
});

describe('HotkeyRecorder — validation', () => {
  it('shows a validation error when isSupported returns false for the captured key', async () => {
    const onChange = vi.fn();
    const isSupported = (a: string): boolean => a !== 'F13';
    const view = await mount(
      <HotkeyRecorder value="F8" onChange={onChange} isSupported={isSupported} />,
    );
    await click(buttonByText(view.container, 'Record'));
    await press(buttonByText(view.container, 'Recording'), { key: 'F13' });
    expect(onChange).not.toHaveBeenCalled();
    const alert = query(view.container, '[role="alert"]');
    expect(alert.textContent).toContain('F13');
    expect(query(view.container, '[data-testid="hotkey-value"]').textContent).toBe('F8');
    await view.unmount();
  });

  it('shows a soft conflict hint for a bare printable key value', async () => {
    const view = await mount(
      <HotkeyRecorder value="K" onChange={() => {}} isSupported={() => true} />,
    );
    const note = query(view.container, '[role="note"]');
    expect(note.textContent).toMatch(/types characters/i);
    await view.unmount();
  });
});

describe('HotkeyRecorder — reset', () => {
  it('resets to the default and disables reset when already default', async () => {
    const onChange = vi.fn();
    const view = await mount(
      <HotkeyRecorder value="F9" onChange={onChange} isSupported={() => true} defaultHotkey="F8" />,
    );
    await click(buttonByText(view.container, 'Reset'));
    expect(onChange).toHaveBeenCalledWith('F8');
    await view.unmount();

    const atDefault = await mount(
      <HotkeyRecorder value="F8" onChange={() => {}} isSupported={() => true} defaultHotkey="F8" />,
    );
    expect(buttonByText(atDefault.container, 'Reset').disabled).toBe(true);
    await atDefault.unmount();
  });
});
