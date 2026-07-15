// Public surface of the desktop session orchestrator (task 4g). Composition (main.ts, at the
// gate) constructs a `SessionOrchestrator` with the real ports; the renderer receives HudState
// over the ipc-contract channel.
export { SessionOrchestrator, type SessionOrchestratorOptions } from './orchestrator';
export {
  systemClock,
  type AppDetectPort,
  type BufferedUtterance,
  type BufferSink,
  type CaptureFactory,
  type CapturePort,
  type CaptureVad,
  type Clock,
  type HotkeyPort,
  type HudSink,
  type InjectPort,
  type SessionOrchestratorPorts,
  type WsPort,
} from './ports';
