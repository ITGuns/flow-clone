import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from './emitter';

interface Events {
  hello: { name: string };
  count: number;
}

describe('TypedEmitter', () => {
  it('delivers payloads to subscribers and supports unsubscribe', () => {
    const em = new TypedEmitter<Events>();
    const cb = vi.fn();
    const off = em.on('hello', cb);
    em.emit('hello', { name: 'a' });
    off();
    em.emit('hello', { name: 'b' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ name: 'a' });
  });

  it('once fires exactly one time', () => {
    const em = new TypedEmitter<Events>();
    const cb = vi.fn();
    em.once('count', cb);
    em.emit('count', 1);
    em.emit('count', 2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1);
  });

  it('a listener unsubscribing mid-dispatch does not perturb the current emit', () => {
    const em = new TypedEmitter<Events>();
    const calls: string[] = [];
    const offB = em.on('count', () => {
      calls.push('b');
      offB();
    });
    em.on('count', () => calls.push('c'));
    em.emit('count', 1);
    em.emit('count', 2);
    expect(calls).toEqual(['b', 'c', 'c']);
  });
});
