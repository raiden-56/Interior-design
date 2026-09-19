/** Tiny registry allowing UI chrome to trigger a 3D snapshot export. */

type Capturer = () => Promise<void>;
let capturer: Capturer | null = null;

export function registerCapturer(fn: Capturer | null): void {
  capturer = fn;
}

export async function capture3D(): Promise<void> {
  if (capturer) await capturer();
}

export const captureActive = capture3D;

export function hasCapturer(): boolean {
  return capturer !== null;
}