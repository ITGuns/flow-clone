import { describe, it, expect } from 'vitest';
import { PRICING, PRIVACY_CLAIMS } from './content';

// Locks the published figures to BUILD_GUIDE §1. Any drift here is a deliberate pricing change
// and must be made on purpose, not by accident. The built-html test then proves these same
// strings actually survive into the rendered pages.
describe('PRICING source of truth (BUILD_GUIDE §1)', () => {
  it('matches the §1 figures exactly', () => {
    expect(PRICING).toEqual({
      freeWeeklyWords: '2,000',
      proMonthly: '$12',
      proYearly: '$96',
      fairUseCap: '50k',
      trialLength: '14-day',
    });
  });
});

describe('PRIVACY_CLAIMS stay grounded in the architecture', () => {
  it('audio claim asserts non-persistence (ARCHITECTURE §2 / CONTRACTS §7)', () => {
    expect(PRIVACY_CLAIMS.audio.toLowerCase()).toContain('discarded');
  });

  it('transcript claim names the at-rest cipher (CONTRACTS §7)', () => {
    expect(PRIVACY_CLAIMS.transcripts).toContain('AES-256-GCM');
  });

  it('telemetry claim excludes transcript content (CONTRACTS §9)', () => {
    expect(PRIVACY_CLAIMS.telemetry.toLowerCase()).toContain('never');
  });
});
