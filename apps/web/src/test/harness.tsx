// jsdom render harness for the component tests. Dependency-free (react-dom/client + React's `act`,
// no @testing-library) to keep the web test footprint minimal — mirrors the desktop history harness.
// Not a `.test` file; imported only by suites running under the jsdom environment.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  unmount(): Promise<void>;
}

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}

export async function mouseDown(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await flush();
}

export async function mouseUp(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  });
  await flush();
}

/** Dispatch a real keydown on window, then flush. */
export async function keyDown(key: string, code = key): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
    );
  });
  await flush();
}

export async function keyUp(key: string, code = key): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }),
    );
  });
  await flush();
}

/** Dispatch a keydown on a specific element (bubbles to window; sets event.target). */
export async function keyDownOn(el: Element, key: string, code = key): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
  });
  await flush();
}

export async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Run an imperative action (e.g. advancing fake timers, firing a fake event) inside act, then flush. */
export async function run(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function query<T extends Element = Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`no element matches ${selector}`);
  return el;
}

export function queryAll<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function buttonByText(root: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
  );
  if (!match) throw new Error(`no button contains text "${label}"`);
  return match;
}

export function findButtonByText(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
    ) ?? null
  );
}

export function text(root: ParentNode): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function setNativeValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
}
