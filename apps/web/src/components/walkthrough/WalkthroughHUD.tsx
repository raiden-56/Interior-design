'use client';

import * as React from 'react';
import {
  Navigation,
  Layers,
  Sun,
  Moon,
  Sunset,
  Eye,
  EyeOff,
  Scan,
  Camera,
  Settings2,
  Maximize2,
  Minimize2,
  LogOut,
  User,
  Users,
  Plane,
  X,
  ArrowUpDown,
  Info,
} from 'lucide-react';
import { useWalkthroughStore } from '@/stores/walkthrough-store';
import { useEditorStore } from '@/stores/editor-store';
import { useCan } from '@/stores/session-store';
import { captureActive } from '@/lib/capture';
import { cn } from '@/lib/cn';
import { Crosshair, InteractionPrompt } from './InteractionPrompt';
import { WalkthroughMiniMap } from './WalkthroughMiniMap';
import { WalkthroughSettings, Panel } from './WalkthroughSettings';
import { MobileControls } from './MobileControls';
import { getRuntime } from './runtime';
import { requestWalkLock, isTouchDevice } from './hud-bridge';
import type { Destination } from './WalkthroughNavigation';
import type { CameraMode, WalkLighting } from './WalkSettings';

/**
 * Everything drawn over the canvas while walking. Plain DOM, so none of it
 * ends up in a PNG capture, and every piece reads from the walkthrough store
 * — which the runtime only writes when something readable changes.
 */
export function WalkthroughHUD() {
  const phase = useWalkthroughStore((s) => s.phase);
  const paused = useWalkthroughStore((s) => s.paused);
  const hudVisible = useWalkthroughStore((s) => s.hudVisible);
  const immersive = useWalkthroughStore((s) => s.immersive);
  const hintVisible = useWalkthroughStore((s) => s.hintVisible);
  const settings = useWalkthroughStore((s) => s.settings);
  const settingsOpen = useWalkthroughStore((s) => s.settingsOpen);
  const location = useWalkthroughStore((s) => s.location);
  const prompt = useWalkthroughStore((s) => s.prompt);
  const info = useWalkthroughStore((s) => s.info);
  const notice = useWalkthroughStore((s) => s.notice);
  const sitting = useWalkthroughStore((s) => s.sitting);
  const elevatorPicker = useWalkthroughStore((s) => s.elevatorPicker);
  const riding = useWalkthroughStore((s) => s.riding);
  const navOpen = useWalkthroughStore((s) => s.navOpen);
  const floorsOpen = useWalkthroughStore((s) => s.floorsOpen);
  const navTarget = useWalkthroughStore((s) => s.navTarget);
  const mode = useWalkthroughStore((s) => s.mode);
  const touch = React.useMemo(() => isTouchDevice(), []);

  // Fullscreen follows the immersive flag, best effort.
  React.useEffect(() => {
    if (phase === 'off') return;
    if (immersive && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined);
    if (!immersive && document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  }, [immersive, phase]);

  if (phase === 'off') return null;
  const hc = settings.highContrastPrompts;
  const entering = phase === 'entering';
  const exiting = phase === 'exiting';
  const active = phase === 'active';
  const overlayOpen = navOpen || floorsOpen || settingsOpen || !!elevatorPicker;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none">
      {/* Vignette during the flights, so the switch never looks like a glitch. */}
      <div className={cn('absolute inset-0 transition-opacity duration-500', entering || exiting ? 'opacity-100' : 'opacity-0')} style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
      {(entering || exiting) && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1 text-[11px] font-medium tracking-wider text-zinc-300 backdrop-blur">
          {entering ? 'ENTERING WALKTHROUGH' : 'RETURNING TO EDITOR'}
        </div>
      )}

      {active && hudVisible && (
        <>
          {/* Top-left: where am I */}
          <LocationCard location={location} mode={mode} riding={riding} />

          {/* Top-right: map + tools */}
          <div className="absolute right-3 top-3 flex items-start gap-2">
            <Toolbar touch={touch} />
            <WalkthroughMiniMap />
          </div>

          {!paused && !overlayOpen && <Crosshair active={!!prompt && !prompt.passive} highContrast={hc} />}
          {!paused && !overlayOpen && <InteractionPrompt prompt={prompt} highContrast={hc} />}

          {sitting && !paused && (
            <div className="absolute bottom-[16%] left-1/2 -translate-x-1/2 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1 text-[11px] text-violet-200 backdrop-blur">
              {sitting.kind === 'lie' ? 'Lying on' : 'Seated on'} {sitting.name} · <kbd className="font-mono2">E</kbd> to {sitting.kind === 'lie' ? 'get up' : 'stand'}
            </div>
          )}

          {navTarget && (
            <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/15 px-3 py-1 text-[11px] text-sky-100 backdrop-blur">
              <Navigation className="h-3 w-3" /> Guiding you to <b>{navTarget.label}</b> · {navTarget.length.toFixed(0)} m
              <button className="pointer-events-auto ml-1 rounded p-0.5 hover:bg-white/10" onClick={() => getRuntime()?.clearRoute()} title="Stop guidance">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Bottom-left hints */}
          {!touch && (
            <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-black/45 px-2.5 py-1.5 text-[10px] text-zinc-300 backdrop-blur">
              <Hint k="WASD" v="Move" />
              <Hint k="Shift" v="Run" />
              <Hint k="E" v="Interact" />
              <Hint k="C" v="Ceiling" />
              <Hint k="N" v="Navigate" />
              <Hint k="1·2·3" v="Camera" />
              <Hint k="H" v="Hide HUD" />
              <Hint k="Esc" v="Exit" />
            </div>
          )}

          {info && <InfoCard info={info} onClose={() => useWalkthroughStore.getState().setInfo(null)} />}

          {hintVisible && !touch && <EntryHint onClose={() => useWalkthroughStore.getState().setHintVisible(false)} />}

          <div className="absolute right-3 top-3 mt-[calc(196px+2.75rem)] flex flex-col items-end gap-2" style={{ pointerEvents: 'none' }}>
            {navOpen && <NavigatePanel />}
            {floorsOpen && <FloorsPanel />}
            {settingsOpen && <WalkthroughSettings />}
          </div>

          {touch && <MobileControls />}
        </>
      )}

      {active && !hudVisible && !paused && <Crosshair active={!!prompt && !prompt.passive} highContrast={hc} />}
      {active && !hudVisible && !paused && <InteractionPrompt prompt={prompt} highContrast={hc} />}

      {notice && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-zinc-100 shadow-xl backdrop-blur">
          {notice.text}
        </div>
      )}

      {active && elevatorPicker && <ElevatorPickerCard picker={elevatorPicker} />}

      {active && riding && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-black/55 px-5 py-3 text-center text-xs text-zinc-200 backdrop-blur">
          <ArrowUpDown className="mx-auto mb-1 h-5 w-5 animate-pulse text-sky-300" />
          Elevator moving…
        </div>
      )}

      {active && paused && !overlayOpen && <PauseOverlay />}
    </div>
  );
}

function Hint({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-white/15 bg-white/10 px-1 font-mono2 text-[9px] text-zinc-100">{k}</kbd>
      <span>{v}</span>
    </span>
  );
}

function LocationCard({ location, mode, riding }: { location: ReturnType<typeof useWalkthroughStore.getState>['location']; mode: CameraMode; riding: boolean }) {
  const [showArea, setShowArea] = React.useState(true);
  React.useEffect(() => {
    setShowArea(true);
    const t = setTimeout(() => setShowArea(false), 4500);
    return () => clearTimeout(t);
  }, [location.changedAt]);
  return (
    <div className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/50 px-3 py-2 backdrop-blur">
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{location.floorName || 'Walkthrough'}</div>
      <div className="text-sm font-semibold text-zinc-100">{location.roomName || (riding ? 'Elevator' : 'Outside the rooms')}</div>
      <div className={cn('text-[11px] text-sky-300 transition-opacity duration-700', showArea && location.roomArea != null ? 'opacity-100' : 'opacity-0')}>
        {location.roomArea != null ? `${location.roomArea.toFixed(1)} m²` : ' '}
      </div>
      {mode !== 'first' && <div className="mt-1 text-[10px] text-violet-300">{mode === 'third' ? 'Third person · 1 for first person' : 'Free camera · 1 to walk again'}</div>}
    </div>
  );
}

function Toolbar({ touch }: { touch: boolean }) {
  const st = useWalkthroughStore();
  const canExport = useCan('exportFiles');
  const lightingIcon = st.lighting === 'day' ? <Sun className="h-4 w-4" /> : st.lighting === 'evening' ? <Sunset className="h-4 w-4" /> : <Moon className="h-4 w-4" />;
  const nextLighting: Record<WalkLighting, WalkLighting> = { day: 'evening', evening: 'night', night: 'day' };
  const modeIcon = st.mode === 'first' ? <User className="h-4 w-4" /> : st.mode === 'third' ? <Users className="h-4 w-4" /> : <Plane className="h-4 w-4" />;
  const nextMode: Record<CameraMode, CameraMode> = { first: 'third', third: 'free', free: 'first' };
  const modeLabel: Record<CameraMode, string> = { first: 'First person (1)', third: 'Third person (2)', free: 'Free camera (3)' };

  return (
    <div className="pointer-events-auto flex flex-col gap-0.5 rounded-lg border border-white/10 bg-black/50 p-1 backdrop-blur">
      <TB title="Navigate to… (N)" active={st.navOpen} onClick={() => st.setNavOpen(!st.navOpen)}>
        <Navigation className="h-4 w-4" />
      </TB>
      <TB title="Jump to floor (J)" active={st.floorsOpen} onClick={() => st.setFloorsOpen(!st.floorsOpen)}>
        <Layers className="h-4 w-4" />
      </TB>
      <TB title={`Lighting: ${st.lighting} (L)`} onClick={() => st.setLighting(nextLighting[st.lighting])}>
        {lightingIcon}
      </TB>
      <TB title={st.ceilingVisible ? 'Hide ceiling (C)' : 'Show ceiling (C)'} active={!st.ceilingVisible} onClick={st.toggleCeiling}>
        {st.ceilingVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </TB>
      <TB title="Design view: see-through walls (X)" active={st.designView} onClick={st.toggleDesignView}>
        <Scan className="h-4 w-4" />
      </TB>
      <TB title={modeLabel[st.mode]} onClick={() => st.setMode(nextMode[st.mode])}>
        {modeIcon}
      </TB>
      {canExport && (
        <TB
          title="Capture this view as PNG (P)"
          onClick={() => {
            void captureActive();
            st.setNotice('View captured');
          }}
        >
          <Camera className="h-4 w-4" />
        </TB>
      )}
      <TB title="Settings" active={st.settingsOpen} onClick={() => st.setSettingsOpen(!st.settingsOpen)}>
        <Settings2 className="h-4 w-4" />
      </TB>
      {!touch && (
        <TB title={st.immersive ? 'Leave fullscreen (F)' : 'Fullscreen (F)'} active={st.immersive} onClick={st.toggleImmersive}>
          {st.immersive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </TB>
      )}
      <div className="my-0.5 h-px bg-white/10" />
      <TB title="Exit walkthrough (Esc)" onClick={st.requestExit} danger>
        <LogOut className="h-4 w-4" />
      </TB>
    </div>
  );
}

function TB({ title, active, danger, onClick, children }: React.PropsWithChildren<{ title: string; active?: boolean; danger?: boolean; onClick: () => void }>) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-md p-1.5 text-zinc-300 hover:bg-white/10 hover:text-white',
        active && 'bg-sky-500/25 text-sky-200',
        danger && 'hover:bg-red-500/20 hover:text-red-200',
      )}
    >
      {children}
    </button>
  );
}

function PauseOverlay() {
  const requestExit = useWalkthroughStore((s) => s.requestExit);
  const openSettings = () => useWalkthroughStore.getState().setSettingsOpen(true);
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/35" onClick={() => requestWalkLock()}>
      <div className="rounded-2xl border border-white/10 bg-[#0b0f16]/90 px-6 py-5 text-center shadow-2xl backdrop-blur" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold text-zinc-100">Walkthrough paused</div>
        <p className="mt-1 max-w-xs text-xs text-zinc-400">Click to take control of the camera. Press <kbd className="font-mono2">Esc</kbd> again to return to the editor.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button onClick={() => requestWalkLock()} className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500">
            Resume
          </button>
          <button onClick={openSettings} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
            Settings
          </button>
          <button onClick={requestExit} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
            Exit walkthrough
          </button>
        </div>
      </div>
    </div>
  );
}

function EntryHint({ onClose }: { onClose: () => void }) {
  const rows = [
    ['WASD', 'Move'],
    ['Mouse', 'Look'],
    ['Shift', 'Run'],
    ['Ctrl / Alt', 'Slow walk'],
    ['E', 'Interact · sit · open'],
    ['C', 'Ceiling on/off'],
    ['Esc', 'Pause / exit'],
  ];
  return (
    <div className="pointer-events-auto absolute bottom-16 left-1/2 w-64 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b0f16]/85 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Walkthrough mode</span>
        <button onClick={onClose} className="rounded p-0.5 text-zinc-500 hover:text-zinc-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <kbd className="rounded border border-white/15 bg-white/10 px-1.5 font-mono2 text-[10px] text-zinc-100">{k}</kbd>
            <span className="text-zinc-400">{v}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function InfoCard({ info, onClose }: { info: { title: string; lines: string[] }; onClose: () => void }) {
  return (
    <div className="pointer-events-auto absolute bottom-16 right-3 w-60 rounded-xl border border-white/10 bg-[#0b0f16]/90 p-3 shadow-2xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
          <Info className="h-3.5 w-3.5 text-sky-300" /> {info.title}
        </span>
        <button onClick={onClose} className="rounded p-0.5 text-zinc-500 hover:text-zinc-200">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {info.lines.map((l) => (
        <div key={l} className="text-[11px] text-zinc-400">
          {l}
        </div>
      ))}
    </div>
  );
}

function ElevatorPickerCard({ picker }: { picker: NonNullable<ReturnType<typeof useWalkthroughStore.getState>['elevatorPicker']> }) {
  const close = () => useWalkthroughStore.getState().setElevatorPicker(null);
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/30">
      <div className="w-64 rounded-2xl border border-white/10 bg-[#0b0f16]/95 p-4 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Choose a floor</span>
          <button onClick={close} className="rounded p-0.5 text-zinc-500 hover:text-zinc-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {picker.floors.map((f) => (
            <button
              key={f.id}
              disabled={f.current}
              onClick={() => getRuntime()?.rideTo(picker.objectId, f.id)}
              className={cn('rounded-lg border px-3 py-2 text-xs', f.current ? 'cursor-default border-zinc-800 text-zinc-600' : 'border-zinc-700 text-zinc-200 hover:border-sky-500/50 hover:bg-sky-500/10')}
            >
              {f.name}
              {f.current && <span className="block text-[9px] uppercase tracking-wider text-zinc-600">here</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NavigatePanel() {
  const close = () => useWalkthroughStore.getState().setNavOpen(false);
  const [query, setQuery] = React.useState('');
  const rt = getRuntime();
  const dests = React.useMemo(() => rt?.destinations() ?? [], [rt]);
  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Destination[]>();
    for (const d of dests) {
      if (q && !d.label.toLowerCase().includes(q)) continue;
      const list = map.get(d.floorName) ?? [];
      list.push(d);
      map.set(d.floorName, list);
    }
    return Array.from(map.entries());
  }, [dests, query]);
  const go = (d: Destination) => {
    if (getRuntime()?.navigateTo(d)) close();
  };
  return (
    <Panel title="Navigate to" onClose={close} width="w-72">
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rooms and furniture…" className="mb-2 w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-sky-500/60" />
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {groups.map(([floorName, list]) => (
          <div key={floorName}>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">{floorName}</div>
            <div className="space-y-0.5">
              {list.map((d) => (
                <button key={d.id} onClick={() => go(d)} className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] text-zinc-200 hover:bg-white/10">
                  <span className="truncate">{d.label}</span>
                  <span className="ml-2 shrink-0 text-[9px] uppercase tracking-wider text-zinc-500">{d.kind}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="py-4 text-center text-[11px] text-zinc-500">Nothing matches</div>}
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">A route is drawn on the floor and on the map. Stairs are part of the route; the lift is not.</p>
    </Panel>
  );
}

function FloorsPanel() {
  const close = () => useWalkthroughStore.getState().setFloorsOpen(false);
  const floors = useEditorStore((s) => s.project.floors);
  const current = useWalkthroughStore((s) => s.location.floorId);
  return (
    <Panel title="Jump to floor" onClose={close} width="w-56">
      <div className="space-y-1">
        {floors
          .filter((f) => f.visible)
          .map((f) => (
            <button
              key={f.id}
              disabled={f.id === current}
              onClick={() => {
                if (getRuntime()?.jumpToFloor(f.id)) close();
              }}
              className={cn('flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-[11px]', f.id === current ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-zinc-800 text-zinc-200 hover:border-zinc-600 hover:bg-white/5')}
            >
              {f.name}
              {f.id === current && <span className="text-[9px] uppercase tracking-wider">here</span>}
            </button>
          ))}
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">A shortcut, not a replacement for the stairs: you land on the nearest safe spot on that floor.</p>
    </Panel>
  );
}
