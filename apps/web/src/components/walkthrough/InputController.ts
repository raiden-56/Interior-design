'use client';

/**
 * Turns keyboard, pointer-lock mouse, touch and gamepad into one `FrameInput`
 * per frame. Nothing here knows about the player; it only accumulates what
 * the person did since the last frame and hands it over.
 */

import type { FrameInput } from './PlayerController';

export type HotkeyHandler = (code: string, e: KeyboardEvent) => boolean;

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight']);

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export class InputController {
  private keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private interactQueued = false;
  private jumpQueued = false;
  private touchMove = { x: 0, y: 0 };
  private touchSprint = false;
  private padInteractWas = false;
  private padBackWas = false;
  private attached = false;
  /** When true, mouse deltas are consumed (pointer is locked or touch-look is active). */
  looking = false;
  /** Gamepad look scale: pixels-equivalent per second at full deflection. */
  padLookRate = 700;

  private hotkey: HotkeyHandler;

  constructor(hotkey: HotkeyHandler) {
    this.hotkey = hotkey;
  }

  attach(): void {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.keys.clear();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) {
      // Typing in a HUD field (the navigate search): letters stay in the
      // field, but Esc still closes the panel / pauses, as everywhere else.
      if (e.code === 'Escape' && this.hotkey(e.code, e)) {
        (e.target as HTMLElement).blur?.();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    // Hotkeys first (E, C, F …); they are consumed so the editor never sees them.
    if (!e.repeat && this.hotkey(e.code, e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (MOVE_KEYS.has(e.code)) {
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      // Ctrl+W would close the tab; swallow the combination while walking.
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.looking) return;
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  };

  // --- touch / on-screen controls -------------------------------------------

  setTouchMove(x: number, y: number): void {
    this.touchMove = { x, y };
  }

  addLook(dx: number, dy: number): void {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  pressInteract(): void {
    this.interactQueued = true;
  }

  setTouchSprint(v: boolean): void {
    this.touchSprint = v;
  }

  // --- gamepad ----------------------------------------------------------------

  private pollGamepad(dt: number, out: { fwd: number; str: number; sprint: boolean }): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pad = Array.from(navigator.getGamepads()).find((p) => p && p.connected);
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    out.str += lx;
    out.fwd -= ly;
    this.lookDX += rx * this.padLookRate * dt;
    this.lookDY += ry * this.padLookRate * dt;
    const a = !!pad.buttons[0]?.pressed;
    if (a && !this.padInteractWas) this.interactQueued = true;
    this.padInteractWas = a;
    const b = !!pad.buttons[1]?.pressed;
    if (b && !this.padBackWas) this.hotkey('Escape', new KeyboardEvent('keydown', { code: 'Escape' }));
    this.padBackWas = b;
    if (pad.buttons[10]?.pressed || pad.buttons[6]?.pressed) out.sprint = true;
    if (pad.buttons[2]?.pressed) this.jumpQueued = true;
  }

  // --- per frame ----------------------------------------------------------------

  /** Drains the accumulated input. Call exactly once per frame. */
  frame(dt: number): FrameInput {
    const k = this.keys;
    const acc = {
      fwd: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.touchMove.y,
      str: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touchMove.x,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint,
    };
    this.pollGamepad(dt, acc);
    const input: FrameInput = {
      forward: Math.max(-1, Math.min(1, acc.fwd)),
      strafe: Math.max(-1, Math.min(1, acc.str)),
      sprint: acc.sprint,
      slow: k.has('ControlLeft') || k.has('ControlRight') || k.has('AltLeft') || k.has('AltRight'),
      jump: this.jumpQueued || k.has('Space'),
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      interact: this.interactQueued,
    };
    this.lookDX = 0;
    this.lookDY = 0;
    this.interactQueued = false;
    this.jumpQueued = false;
    return input;
  }

  /** True when any movement key is held — used to dismiss the entry hint. */
  get moving(): boolean {
    return this.keys.size > 0 || this.touchMove.x !== 0 || this.touchMove.y !== 0;
  }
}
