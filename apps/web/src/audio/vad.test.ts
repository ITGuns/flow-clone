import { describe, it, expect } from 'vitest';
import { EnergyVAD } from './vad';
import { floatTo16BitPCM } from './dsp';
import { constant, silence } from './test-signals';

const loud = floatTo16BitPCM(constant(0.5, 320));
const quiet = floatTo16BitPCM(silence(320));

describe('EnergyVAD', () => {
  it('reports a non-zero level and speaking=true for a loud frame', () => {
    const r = new EnergyVAD().process(loud);
    expect(r.level).toBeGreaterThan(0.4);
    expect(r.speaking).toBe(true);
  });

  it('reports speaking=false for silence past the hangover tail', () => {
    const vad = new EnergyVAD({ hangoverFrames: 0 });
    expect(vad.process(quiet).speaking).toBe(false);
  });

  it('holds speaking across a brief gap for hangoverFrames, then drops', () => {
    const vad = new EnergyVAD({ hangoverFrames: 2 });
    expect(vad.process(loud).speaking).toBe(true);
    expect(vad.process(quiet).speaking).toBe(true); // hangover 1
    expect(vad.process(quiet).speaking).toBe(true); // hangover 2
    expect(vad.process(quiet).speaking).toBe(false); // tail exhausted
  });

  it('reset() clears the hangover state', () => {
    const vad = new EnergyVAD({ hangoverFrames: 5 });
    vad.process(loud);
    vad.reset();
    expect(vad.process(quiet).speaking).toBe(false);
  });

  it.each([-1, NaN])('throws on an invalid threshold (%s)', (threshold) => {
    expect(() => new EnergyVAD({ threshold })).toThrow(RangeError);
  });

  it.each([-1, 1.5])('throws on an invalid hangoverFrames (%s)', (hangoverFrames) => {
    expect(() => new EnergyVAD({ hangoverFrames })).toThrow(RangeError);
  });
});
