// Compile-time proof that the REAL repo classes/interfaces structurally satisfy the orchestrator's
// ports, so the gate composition (main.ts) will typecheck. These assignment functions do not run
// any native code — they only exercise the type relationships. If a consumed public API drifts,
// this file stops compiling (contract friction, reported up — never worked around).
import { describe, expect, it } from 'vitest';
import { AudioCapture } from '../../audio';
import { WsClient } from '../../ws';
import type { ActiveAppDetector, HotkeyManager, TextInjector } from '../../native';
import type { AppDetectPort, CapturePort, HotkeyPort, InjectPort, WsPort } from './ports';

const asHotkey = (x: HotkeyManager): HotkeyPort => x;
const asCapture = (x: AudioCapture): CapturePort => x;
const asWs = (x: WsClient): WsPort => x;
const asInject = (x: TextInjector): InjectPort => x;
const asAppDetect = (x: ActiveAppDetector): AppDetectPort => x;

describe('port conformance (types only)', () => {
  it('real classes/interfaces are assignable to the narrow ports', () => {
    expect(
      [asHotkey, asCapture, asWs, asInject, asAppDetect].every((f) => typeof f === 'function'),
    ).toBe(true);
  });
});
