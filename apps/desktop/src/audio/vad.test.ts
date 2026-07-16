import { describe, it, expect } from 'vitest';
import { EnergyVAD } from './vad';
import { floatTo16BitPCM } from './dsp';
import { sine, silence } from './test-signals';

const SAMPLES = 320; // one 20ms frame @ 16kHz
const silentFrame = floatTo16BitPCM(silence(SAMPLES));
const loudFrame = floatTo16BitPCM(sine(SAMPLES, 300, 16000, 0.5));

describe('EnergyVAD', () => {
  it('reports not-speaking and ~0 level on silence', () => {
    const vad = new EnergyVAD();
    const r = vad.process(silentFrame);
    expect(r.speaking).toBe(false);
    expect(r.level).toBeCloseTo(0, 5);
  });

  it('reports speaking with a level in (0, 1] on a loud sine', () => {
    const vad = new EnergyVAD();
    const r = vad.process(loudFrame);
    expect(r.speaking).toBe(true);
    expect(r.level).toBeGreaterThan(0);
    expect(r.level).toBeLessThanOrEqual(1);
  });

  it('holds speaking through the hangover window after a step down, then drops', () => {
    const vad = new EnergyVAD({ hangoverFrames: 3 });
    expect(vad.process(loudFrame).speaking).toBe(true); // active, hangover armed to 3
    // Now silence: speaking stays true for exactly 3 frames, then false.
    expect(vad.process(silentFrame).speaking).toBe(true); // 3 → 2
    expect(vad.process(silentFrame).speaking).toBe(true); // 2 → 1
    expect(vad.process(silentFrame).speaking).toBe(true); // 1 → 0
    expect(vad.process(silentFrame).speaking).toBe(false); // exhausted
  });

  it('honors a custom threshold (a quiet sine below threshold is not speaking)', () => {
    const quiet = floatTo16BitPCM(sine(SAMPLES, 300, 16000, 0.01));
    const vad = new EnergyVAD({ threshold: 0.1, hangoverFrames: 0 });
    expect(vad.process(quiet).speaking).toBe(false);
  });

  it('level tracks amplitude', () => {
    const vad = new EnergyVAD();
    const loud = vad.process(floatTo16BitPCM(sine(SAMPLES, 300, 16000, 0.8))).level;
    const quiet = vad.process(floatTo16BitPCM(sine(SAMPLES, 300, 16000, 0.2))).level;
    expect(loud).toBeGreaterThan(quiet);
  });

  it('reset clears the hangover tail', () => {
    const vad = new EnergyVAD({ hangoverFrames: 5 });
    vad.process(loudFrame);
    vad.reset();
    expect(vad.process(silentFrame).speaking).toBe(false);
  });

  it('rejects invalid options', () => {
    expect(() => new EnergyVAD({ threshold: -1 })).toThrow(RangeError);
    expect(() => new EnergyVAD({ hangoverFrames: -1 })).toThrow(RangeError);
    expect(() => new EnergyVAD({ hangoverFrames: 1.5 })).toThrow(RangeError);
  });
});
