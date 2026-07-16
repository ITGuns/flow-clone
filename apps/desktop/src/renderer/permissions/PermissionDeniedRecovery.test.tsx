// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PermissionDeniedRecovery } from './PermissionDeniedRecovery';
import { mount, click, buttonByText, query } from './dom-harness';

describe('PermissionDeniedRecovery — OS-specific guidance + recovery actions', () => {
  it('macOS microphone: points at System Settings, offers Open Settings + Re-check', async () => {
    const onRecheck = vi.fn();
    const onOpenSettings = vi.fn();
    const view = await mount(
      <PermissionDeniedRecovery
        kind="microphone"
        platform="macos"
        reason="denied"
        onRecheck={onRecheck}
        onOpenSettings={onOpenSettings}
      />,
    );
    const text = view.container.textContent ?? '';
    expect(text).toContain('System Settings');
    expect(text).toContain('Microphone');

    await click(buttonByText(view.container, 'Open System Settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await click(buttonByText(view.container, 'Re-check'));
    expect(onRecheck).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('Windows microphone: gives the Windows Settings path', async () => {
    const view = await mount(
      <PermissionDeniedRecovery
        kind="microphone"
        platform="windows"
        reason="denied"
        onRecheck={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const text = view.container.textContent ?? '';
    expect(text).toContain('Privacy & security');
    expect(text).toContain('Microphone');
    await view.unmount();
  });

  it('macOS accessibility: points at the Accessibility pane', async () => {
    const view = await mount(
      <PermissionDeniedRecovery
        kind="accessibility"
        platform="macos"
        reason="denied"
        onRecheck={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(view.container.textContent ?? '').toContain('Accessibility');
    await view.unmount();
  });

  it('uses alertdialog semantics wired to its title/description', async () => {
    const view = await mount(
      <PermissionDeniedRecovery
        kind="microphone"
        platform="macos"
        reason="denied"
        onRecheck={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const dialog = query(view.container, '[role="alertdialog"]');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    await view.unmount();
  });

  it('restricted: suppresses the Settings deep-link but keeps Re-check', async () => {
    const onOpenSettings = vi.fn();
    const view = await mount(
      <PermissionDeniedRecovery
        kind="microphone"
        platform="macos"
        reason="restricted"
        onRecheck={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    );
    const text = view.container.textContent ?? '';
    expect(text.toLowerCase()).toContain('managed'); // "managed by your organization…"
    // No settings button to click for a policy-restricted permission.
    expect(() => buttonByText(view.container, 'Open')).toThrow();
    // Re-check is still available.
    expect(buttonByText(view.container, 'Re-check')).toBeTruthy();
    await view.unmount();
  });
});
