import { describe, it, expect } from 'vitest';
import {
  acceleratorFromEvent,
  describeHotkeyConflict,
  type KeyLikeEvent,
} from './accelerator-capture';

function ev(partial: Partial<KeyLikeEvent> & { key: string }): KeyLikeEvent {
  return {
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...partial,
  };
}

describe('acceleratorFromEvent', () => {
  it('records a function key as-is', () => {
    expect(acceleratorFromEvent(ev({ key: 'F8' }))).toBe('F8');
    expect(acceleratorFromEvent(ev({ key: 'F12' }))).toBe('F12');
  });

  it('records Space from key or code', () => {
    expect(acceleratorFromEvent(ev({ key: ' ' }))).toBe('Space');
    expect(acceleratorFromEvent(ev({ key: 'Unidentified', code: 'Space' }))).toBe('Space');
  });

  it('uppercases letters and joins modifiers in canonical order', () => {
    expect(acceleratorFromEvent(ev({ key: 'k' }))).toBe('K');
    expect(acceleratorFromEvent(ev({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(
      'Control+Shift+K',
    );
    expect(acceleratorFromEvent(ev({ key: ' ', altKey: true }))).toBe('Alt+Space');
  });

  it('maps arrows and meta to Super', () => {
    expect(acceleratorFromEvent(ev({ key: 'ArrowUp' }))).toBe('Up');
    expect(acceleratorFromEvent(ev({ key: 'a', metaKey: true }))).toBe('Super+A');
  });

  it('records digits via code even when Shift rewrites the character', () => {
    expect(acceleratorFromEvent(ev({ key: '@', code: 'Digit2', shiftKey: true }))).toBe('Shift+2');
  });

  it('returns null for a modifier-only press (still mid-chord)', () => {
    expect(acceleratorFromEvent(ev({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev({ key: 'Meta', metaKey: true }))).toBeNull();
  });

  it('returns null for an unmappable key', () => {
    expect(acceleratorFromEvent(ev({ key: 'Dead' }))).toBeNull();
  });
});

describe('describeHotkeyConflict', () => {
  it('warns on a bare printable key with no modifier', () => {
    expect(describeHotkeyConflict('K')).toMatch(/types characters/i);
    expect(describeHotkeyConflict('Space')).toMatch(/types characters/i);
    expect(describeHotkeyConflict('2')).toMatch(/types characters/i);
  });

  it('is quiet for a function key or a modified chord', () => {
    expect(describeHotkeyConflict('F8')).toBeNull();
    expect(describeHotkeyConflict('Alt+Space')).toBeNull();
    expect(describeHotkeyConflict('Control+Shift+K')).toBeNull();
  });
});
