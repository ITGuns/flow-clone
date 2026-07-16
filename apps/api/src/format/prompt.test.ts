import { describe, it, expect } from 'vitest';
import type { DictionaryEntry, Register } from '@undertone/shared';
import { buildSystemPrompt, renderDictionaryLine } from './prompt';

function entry(phrase: string, soundsLike: string[] = []): DictionaryEntry {
  return { id: `id-${phrase}`, phrase, soundsLike, createdAt: '2026-07-14T00:00:00.000Z' };
}

describe('renderDictionaryLine', () => {
  it('renders the misheard-as parenthetical when soundsLike is present', () => {
    expect(renderDictionaryLine(entry('Kubernetes', ['cooper netties', 'kuberneti']))).toBe(
      'Kubernetes (may be misheard as: cooper netties, kuberneti)',
    );
  });

  it('renders a bare phrase when there are no mishearings', () => {
    expect(renderDictionaryLine(entry('Postgres'))).toBe('Postgres');
  });
});

describe('buildSystemPrompt', () => {
  it('embeds the §4.3 grammar verbatim with disambiguation guidance', () => {
    const prompt = buildSystemPrompt('chat', []);
    expect(prompt).toContain('"new line"');
    expect(prompt).toContain('"new paragraph"');
    expect(prompt).toContain('"scratch that"');
    expect(prompt).toContain('"all caps X end caps"');
    expect(prompt).toContain('"quote X end quote"');
    expect(prompt).toContain('"bullet list"');
    // imperative-vs-dictated-prose disambiguation
    expect(prompt).toContain('the Jurassic period');
  });

  it('includes one conditioning line per Register value and marks the active one', () => {
    const registers: Register[] = ['chat', 'email', 'code', 'document', 'terminal', 'unknown'];
    const prompt = buildSystemPrompt('email', []);
    for (const r of registers) {
      expect(prompt).toContain(`- ${r} —`);
    }
    expect(prompt).toContain('Active register: email.');
  });

  it('injects already-filtered dictionary entries as misheard-as lines', () => {
    const prompt = buildSystemPrompt('code', [entry('Kubernetes', ['cooper netties'])]);
    expect(prompt).toContain('- Kubernetes (may be misheard as: cooper netties)');
  });

  it('notes when no dictionary is provided', () => {
    expect(buildSystemPrompt('unknown', [])).toContain('DICTIONARY: none provided');
  });

  it('carries the do-no-harm instruction and the output contract', () => {
    const prompt = buildSystemPrompt('document', []);
    expect(prompt).toContain('DO NO HARM');
    expect(prompt).toMatch(/return it unchanged/i);
    expect(prompt).toContain('OUTPUT:');
    expect(prompt).toMatch(/no code fences/i);
  });
});
