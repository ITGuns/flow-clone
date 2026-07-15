// Clipboard write with an injectable target so the copy button is unit-testable without a real
// navigator.clipboard (absent in jsdom by default). Returns whether the write succeeded.
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export async function copyText(text: string, clipboard?: ClipboardLike): Promise<boolean> {
  const target =
    clipboard ??
    (typeof navigator !== 'undefined'
      ? (navigator.clipboard as ClipboardLike | undefined)
      : undefined);
  if (!target || typeof target.writeText !== 'function') return false;
  try {
    await target.writeText(text);
    return true;
  } catch {
    return false;
  }
}
