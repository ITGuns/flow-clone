// Raised when the platform-native addon cannot be loaded — wrong OS, or a build that shipped
// without the compiled binary. The message is deliberately stable so the main process / HUD can
// surface a single clear state ("native module unavailable on this platform/build").
export class NativeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NativeUnavailableError';
  }
}
