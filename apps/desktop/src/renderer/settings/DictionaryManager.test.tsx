// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import type { DictionaryEntry } from '@undertone/shared';
import { DictionaryManager } from './DictionaryManager';
import { FakeDictionaryApi } from './fake-dictionary-api';
import { mount, click, buttonByText, query, flush } from '../permissions/dom-harness';

function entry(phrase: string, soundsLike: string[] = []): DictionaryEntry {
  return { id: `id-${phrase}`, phrase, soundsLike, createdAt: new Date(0).toISOString() };
}

/** Set a controlled input's value the way React expects, then flush. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

async function pressEnter(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
    );
  });
  await flush();
}

describe('DictionaryManager — list', () => {
  it('renders existing entries with their soundsLike', async () => {
    const api = new FakeDictionaryApi({ entries: [entry('Kubernetes', ['cooper netties'])] });
    const view = await mount(<DictionaryManager api={api} />);
    await flush();
    expect(view.container.textContent).toContain('Kubernetes');
    expect(view.container.textContent).toContain('cooper netties');
    await view.unmount();
  });

  it('shows an empty state when there are no entries', async () => {
    const api = new FakeDictionaryApi();
    const view = await mount(<DictionaryManager api={api} />);
    await flush();
    expect(view.container.textContent).toContain('No entries yet');
    await view.unmount();
  });
});

describe('DictionaryManager — create', () => {
  it('adds a new entry with soundsLike tags', async () => {
    const api = new FakeDictionaryApi();
    const view = await mount(<DictionaryManager api={api} />);
    await flush();

    const phraseInput = query<HTMLInputElement>(view.container, 'input.uts-input');
    await typeInto(phraseInput, 'Fastify');
    const tagInput = query<HTMLInputElement>(view.container, '.uts-tag-input');
    await typeInto(tagInput, 'fast if I');
    await pressEnter(tagInput);

    await click(buttonByText(view.container, 'Add entry'));
    await flush();

    expect(view.container.textContent).toContain('Fastify');
    expect(view.container.textContent).toContain('fast if I');
    expect(await api.list()).toHaveLength(1);
    await view.unmount();
  });

  it('renders an inline 409 duplicate error and does not add a row', async () => {
    const api = new FakeDictionaryApi({ entries: [entry('Kubernetes')] });
    const view = await mount(<DictionaryManager api={api} />);
    await flush();

    const phraseInput = query<HTMLInputElement>(view.container, 'input.uts-input');
    await typeInto(phraseInput, 'kubernetes'); // case-insensitive dup
    await click(buttonByText(view.container, 'Add entry'));
    await flush();

    const alert = query(view.container, '[role="alert"]');
    expect(alert.textContent).toMatch(/already have that phrase/i);
    expect(await api.list()).toHaveLength(1); // unchanged
    await view.unmount();
  });

  it('renders an honest 422 cap message when the dictionary is full', async () => {
    const api = new FakeDictionaryApi({ entries: [entry('Only')], cap: 1 });
    const view = await mount(<DictionaryManager api={api} />);
    await flush();

    const phraseInput = query<HTMLInputElement>(view.container, 'input.uts-input');
    await typeInto(phraseInput, 'Another');
    await click(buttonByText(view.container, 'Add entry'));
    await flush();

    const alert = query(view.container, '[role="alert"]');
    expect(alert.textContent).toMatch(/full \(500 entries max\)/i);
    await view.unmount();
  });
});

describe('DictionaryManager — delete', () => {
  it('removes the entry row on delete', async () => {
    const api = new FakeDictionaryApi({ entries: [entry('Kubernetes'), entry('Fastify')] });
    const view = await mount(<DictionaryManager api={api} />);
    await flush();

    await click(query(view.container, '[aria-label="Delete Kubernetes"]'));
    await flush();

    expect(view.container.textContent).not.toContain('Kubernetes');
    expect(view.container.textContent).toContain('Fastify');
    expect(await api.list()).toHaveLength(1);
    await view.unmount();
  });
});

describe('DictionaryManager — edit', () => {
  it('saves a renamed phrase', async () => {
    const api = new FakeDictionaryApi({ entries: [entry('Kuberntes')] });
    const view = await mount(<DictionaryManager api={api} />);
    await flush();

    await click(buttonByText(view.container, 'Edit'));
    await flush();
    const editInput = query<HTMLInputElement>(view.container, '.uts-entry input.uts-input');
    await typeInto(editInput, 'Kubernetes');
    await click(buttonByText(view.container, 'Save'));
    await flush();

    expect(view.container.textContent).toContain('Kubernetes');
    const entries = await api.list();
    expect(entries[0]!.phrase).toBe('Kubernetes');
    await view.unmount();
  });

  it('renders an inline 409 when a rename collides with an existing phrase', async () => {
    const api = new FakeDictionaryApi({ entries: [entry('Kubernetes'), entry('Fastify')] });
    const view = await mount(<DictionaryManager api={api} />);
    await flush();

    // Edit the second entry ("Fastify") and rename it to collide with "Kubernetes".
    const editButtons = Array.from(view.container.querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '') === 'Edit',
    );
    await click(editButtons[1]!);
    await flush();
    const editInput = query<HTMLInputElement>(view.container, '.uts-entry input.uts-input');
    await typeInto(editInput, 'Kubernetes');
    await click(buttonByText(view.container, 'Save'));
    await flush();

    const alert = query(view.container, '[role="alert"]');
    expect(alert.textContent).toMatch(/already have that phrase/i);
    await view.unmount();
  });
});
