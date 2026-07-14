// jsdom render harness for the history component tests (task 4b). Mirrors the permissions harness:
// dependency-free (react-dom/client + React's built-in `act`, no @testing-library) to keep the
// desktop test footprint minimal. Not a `.test` file, so it is typechecked/linted with the sources
// but never run as a suite. Only imported by tests under the jsdom environment.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';

// React's `act` requires this flag to drive react-dom/client without warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  unmount(): Promise<void>;
}

/** Mount a React element into a fresh detached container inside document.body. */
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

/** Dispatch a real click and flush the resulting React work + async state updates. */
export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}

/** Set an <input>'s value and fire a React-visible `input` event, then flush. */
export async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

/** Drain the microtask queue inside act(), so promise-driven state updates are applied. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** First element matching `selector`, or throw a helpful error. */
export function query<T extends Element = Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`no element matches ${selector}`);
  return el;
}

/** All elements matching `selector` as a plain array. */
export function queryAll<T extends Element = Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** The <button> whose visible text contains `label` (case-insensitive), or throw. */
export function buttonByText(root: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
  );
  if (!match) throw new Error(`no button contains text "${label}"`);
  return match;
}

/** Optional variant of {@link buttonByText}: null instead of throwing. */
export function findButtonByText(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
    ) ?? null
  );
}

// React tracks the previous value on the DOM node; to make a programmatic value change visible to
// React's onChange we must bypass its value setter cache. This is the standard jsdom trick.
function setNativeValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
}
