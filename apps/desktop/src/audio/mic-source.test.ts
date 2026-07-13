import { describe, it, expect } from 'vitest';
import { FakeMicSource, type MicChunk } from './mic-source';
import { sine } from './test-signals';

describe('FakeMicSource', () => {
  it('replays constructed fixtures on start with the fixed sample rate', async () => {
    const a = sine(160, 200, 48000, 0.5);
    const b = sine(160, 400, 48000, 0.5);
    const chunks: MicChunk[] = [];
    const src = new FakeMicSource([a, b], 48000);
    await src.start((c) => chunks.push(c));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.sampleRate).toBe(48000);
    expect(chunks[0]?.samples).toBe(a);
    expect(chunks[1]?.samples).toBe(b);
  });

  it('accepts a single Float32Array fixture', async () => {
    const chunks: MicChunk[] = [];
    const src = new FakeMicSource(sine(160, 200, 16000), 16000);
    await src.start((c) => chunks.push(c));
    expect(chunks).toHaveLength(1);
  });

  it('delivers manual emit() pushes to the callback', async () => {
    const chunks: MicChunk[] = [];
    const src = new FakeMicSource([], 16000);
    await src.start((c) => chunks.push(c));
    src.emit(sine(80, 100, 16000));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sampleRate).toBe(16000);
  });

  it('rejects a double start', async () => {
    const src = new FakeMicSource([], 16000);
    await src.start(() => {});
    await expect(src.start(() => {})).rejects.toThrow(/already started/);
  });

  it('emit() is a no-op after stop', async () => {
    const chunks: MicChunk[] = [];
    const src = new FakeMicSource([], 16000);
    await src.start((c) => chunks.push(c));
    await src.stop();
    src.emit(sine(80, 100, 16000));
    expect(chunks).toHaveLength(0);
  });
});
