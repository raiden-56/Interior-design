'use client';

import * as React from 'react';
import { Hand, Zap, LogOut } from 'lucide-react';
import { useWalkthroughStore } from '@/stores/walkthrough-store';
import { getInputController } from './hud-bridge';
import { getRuntime } from './runtime';

/**
 * Touch controls: a joystick on the left, drag-to-look on the right, and
 * three buttons. Desktop keyboard and mouse remain the primary experience;
 * this makes the walkthrough usable on a tablet rather than perfect on one.
 */
export function MobileControls() {
  const requestExit = useWalkthroughStore((s) => s.requestExit);
  const stickRef = React.useRef<HTMLDivElement>(null);
  const knobRef = React.useRef<HTMLDivElement>(null);
  const stickId = React.useRef<number | null>(null);
  const lookId = React.useRef<number | null>(null);
  const lookLast = React.useRef<{ x: number; y: number } | null>(null);
  const RADIUS = 44;

  const setKnob = (dx: number, dy: number) => {
    const k = knobRef.current;
    if (k) k.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onStickDown = (e: React.PointerEvent) => {
    stickId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId || !stickRef.current) return;
    const r = stickRef.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setKnob(dx, dy);
    getInputController()?.setTouchMove(dx / RADIUS, -dy / RADIUS);
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (stickId.current !== e.pointerId) return;
    stickId.current = null;
    setKnob(0, 0);
    getInputController()?.setTouchMove(0, 0);
  };

  const onLookDown = (e: React.PointerEvent) => {
    lookId.current = e.pointerId;
    lookLast.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (lookId.current !== e.pointerId || !lookLast.current) return;
    const dx = e.clientX - lookLast.current.x;
    const dy = e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
    getInputController()?.addLook(dx * 1.6, dy * 1.6);
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (lookId.current === e.pointerId) lookId.current = null;
  };

  return (
    <>
      {/* Look area: right half of the screen. */}
      <div className="pointer-events-auto absolute inset-y-0 right-0 z-10 w-1/2 touch-none" onPointerDown={onLookDown} onPointerMove={onLookMove} onPointerUp={onLookUp} onPointerCancel={onLookUp} />
      {/* Joystick */}
      <div
        ref={stickRef}
        className="pointer-events-auto absolute bottom-24 left-6 z-20 flex h-28 w-28 touch-none items-center justify-center rounded-full border border-white/15 bg-black/35 backdrop-blur"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      >
        <div ref={knobRef} className="h-12 w-12 rounded-full bg-sky-400/70 shadow-lg transition-transform duration-75" />
      </div>
      {/* Buttons */}
      <div className="pointer-events-auto absolute bottom-24 right-6 z-20 flex flex-col items-end gap-3">
        <button
          onPointerDown={() => getRuntime()?.interact()}
          className="flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-sky-500/80 text-white shadow-lg active:scale-95"
          aria-label="Interact"
        >
          <Hand className="h-6 w-6" />
        </button>
        <button
          onPointerDown={() => getInputController()?.setTouchSprint(true)}
          onPointerUp={() => getInputController()?.setTouchSprint(false)}
          onPointerCancel={() => getInputController()?.setTouchSprint(false)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 text-zinc-200 backdrop-blur active:bg-white/20"
          aria-label="Run"
        >
          <Zap className="h-5 w-5" />
        </button>
        <button onClick={requestExit} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 text-zinc-200 backdrop-blur" aria-label="Exit walkthrough">
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}
