import { sessionCan } from '@/stores/session-store';

/** Tiny registry allowing UI chrome to trigger a 3D snapshot export. */

type Capturer = () => Promise<void>;
let capturer: Capturer | null = null;

export function registerCapturer(fn: Capturer | null): void {
  capturer = fn;
}

export async function capture3D(): Promise<void> {
  // Last line of defence: even if a snapshot control somehow renders on a
  // read-only session, no image file is ever produced.
  if (!sessionCan('exportFiles')) return;
  if (capturer) await capturer();
}

export const captureActive = capture3D;

export function hasCapturer(): boolean {
  return capturer !== null;
}