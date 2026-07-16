// Tiny jsdom render harness for the permission component tests (Phase 2d). Not a `.test` file, so
// it is typechecked/linted with the sources but never run as a suite. Deliberately dependency-free
// (react-dom/client + React's built-in `act`, no @testing-library) to keep the desktop app's test
// footprint minimal. Only imported by tests running under the jsdom environment, where `document`
// exists. See the test files' `@vitest-environment jsdom` docblocks.
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

/** Dispatch a real click and flush the resulting React work + any async state updates. */
export async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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

/** The <button> whose visible text contains `label` (case-insensitive). */
export function buttonByText(root: ParentNode, label: string): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll('button'));
  const match = buttons.find((b) =>
    (b.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
  );
  if (!match) throw new Error(`no button contains text "${label}"`);
  return match;
}
