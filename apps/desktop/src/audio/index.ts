// Public surface of the audio capture pipeline (Phase 1a). The renderer wires a
// `WebAudioMicSource` into `AudioCapture`; the WS client (task 1b) consumes `frame` events.
export * from './constants';
export * from './dsp';
export * from './frame-chunker';
export * from './vad';
export * from './mic-source';
export * from './audio-capture';
