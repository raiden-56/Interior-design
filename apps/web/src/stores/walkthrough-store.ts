'use client';

import { create } from 'zustand';
import {
  DEFAULT_WALK_SETTINGS,
  loadWalkSettings,
  normalizeWalkSettings,
  saveWalkSettings,
  type CameraMode,
  type WalkLighting,
  type WalkSettings,
} from '@/components/walkthrough/WalkSettings';

/**
 * Walkthrough state that React needs to *render*: which phase the mode is in,
 * what the HUD says, which overlays are open.
 *
 * Deliberately low-frequency. The player's position, velocity and camera live
 * in the runtime (see PlayerController) and are advanced inside the Three.js
 * loop; this store is only written when something a person can read changes
 * — the room name, a prompt, a notice. Nothing in here is persisted with the
 * project.
 */

export type WalkPhase = 'off' | 'entering' | 'active' | 'exiting';
export type MinimapState = 'full' | 'mini' | 'hidden';

export interface WalkLocation {
  floorId: string | null;
  floorName: string;
  roomId: string | null;
  roomName: string;
  /** m², null outside any room. */
  roomArea: number | null;
  /** When the room last changed, for the area fade. */
  changedAt: number;
}

export interface WalkPrompt {
  key: string;
  text: string;
  passive?: boolean;
}

export interface WalkInfo {
  title: string;
  lines: string[];
}

export interface ElevatorPicker {
  objectId: string;
  floors: { id: string; name: string; current: boolean }[];
}

interface WalkthroughState {
  phase: WalkPhase;
  mode: CameraMode;
  /** Pointer is not locked: show the resume overlay. */
  paused: boolean;
  hudVisible: boolean;
  /** Editor chrome hidden, canvas full-bleed. */
  immersive: boolean;
  /** The controls card shown on entry. */
  hintVisible: boolean;
  settings: WalkSettings;
  settingsOpen: boolean;
  lighting: WalkLighting;
  ceilingVisible: boolean;
  designView: boolean;
  minimap: MinimapState;
  location: WalkLocation;
  prompt: WalkPrompt | null;
  info: WalkInfo | null;
  notice: { text: string; at: number } | null;
  sitting: { objectId: string; name: string; kind: 'sit' | 'lie' } | null;
  elevatorPicker: ElevatorPicker | null;
  riding: boolean;
  navOpen: boolean;
  floorsOpen: boolean;
  navTarget: { id: string; label: string; length: number } | null;
  /** Bumped by the runtime when the route changes, so the minimap redraws. */
  routeNonce: number;

  requestEnter: () => void;
  requestExit: () => void;
  setPhase: (p: WalkPhase) => void;
  setMode: (m: CameraMode) => void;
  setPaused: (v: boolean) => void;
  toggleHud: () => void;
  setImmersive: (v: boolean) => void;
  toggleImmersive: () => void;
  setHintVisible: (v: boolean) => void;
  updateSettings: (patch: Partial<WalkSettings>) => void;
  resetSettings: () => void;
  setSettingsOpen: (v: boolean) => void;
  setLighting: (l: WalkLighting) => void;
  toggleCeiling: () => void;
  toggleDesignView: () => void;
  cycleMinimap: () => void;
  setMinimap: (m: MinimapState) => void;
  setLocation: (loc: Omit<WalkLocation, 'changedAt'>) => void;
  setPrompt: (p: WalkPrompt | null) => void;
  setInfo: (i: WalkInfo | null) => void;
  setNotice: (text: string | null) => void;
  setSitting: (s: WalkthroughState['sitting']) => void;
  setElevatorPicker: (p: ElevatorPicker | null) => void;
  setRiding: (v: boolean) => void;
  setNavOpen: (v: boolean) => void;
  setFloorsOpen: (v: boolean) => void;
  setNavTarget: (t: WalkthroughState['navTarget']) => void;
  bumpRoute: () => void;
  /** Everything back to idle; called when the exit flight completes. */
  finishExit: () => void;
}

const emptyLocation = (): WalkLocation => ({ floorId: null, floorName: '', roomId: null, roomName: '', roomArea: null, changedAt: 0 });

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

export const useWalkthroughStore = create<WalkthroughState>()((set, get) => ({
  phase: 'off',
  mode: 'first',
  paused: false,
  hudVisible: true,
  immersive: false,
  hintVisible: false,
  settings: typeof window === 'undefined' ? { ...DEFAULT_WALK_SETTINGS } : loadWalkSettings(),
  settingsOpen: false,
  lighting: 'day',
  ceilingVisible: true,
  designView: false,
  minimap: 'full',
  location: emptyLocation(),
  prompt: null,
  info: null,
  notice: null,
  sitting: null,
  elevatorPicker: null,
  riding: false,
  navOpen: false,
  floorsOpen: false,
  navTarget: null,
  routeNonce: 0,

  requestEnter: () => {
    if (get().phase !== 'off') return;
    set({ phase: 'entering', paused: false, hintVisible: get().settings.showHints, info: null, prompt: null, notice: null, sitting: null, navTarget: null, elevatorPicker: null, riding: false, navOpen: false, floorsOpen: false, settingsOpen: false });
  },
  requestExit: () => {
    const phase = get().phase;
    if (phase === 'off' || phase === 'exiting') return;
    set({ phase: 'exiting', prompt: null, info: null, elevatorPicker: null, navOpen: false, floorsOpen: false, settingsOpen: false, paused: false });
  },
  setPhase: (phase) => set({ phase }),
  setMode: (mode) => set({ mode }),
  setPaused: (paused) => set((s) => (s.paused === paused ? s : { paused })),
  toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),
  setImmersive: (immersive) => set({ immersive }),
  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),
  setHintVisible: (hintVisible) => set({ hintVisible }),
  updateSettings: (patch) => {
    const settings = normalizeWalkSettings({ ...get().settings, ...patch });
    saveWalkSettings(settings);
    set({ settings });
  },
  resetSettings: () => {
    const settings = { ...DEFAULT_WALK_SETTINGS };
    saveWalkSettings(settings);
    set({ settings });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setLighting: (lighting) => set({ lighting }),
  toggleCeiling: () => set((s) => ({ ceilingVisible: !s.ceilingVisible })),
  toggleDesignView: () => set((s) => ({ designView: !s.designView })),
  cycleMinimap: () => set((s) => ({ minimap: s.minimap === 'full' ? 'mini' : s.minimap === 'mini' ? 'hidden' : 'full' })),
  setMinimap: (minimap) => set({ minimap }),
  setLocation: (loc) =>
    set((s) => {
      const same = s.location.floorId === loc.floorId && s.location.roomId === loc.roomId && s.location.roomName === loc.roomName && s.location.floorName === loc.floorName;
      if (same) return s;
      return { location: { ...loc, changedAt: Date.now() } };
    }),
  setPrompt: (prompt) =>
    set((s) => {
      const a = s.prompt;
      if (a === prompt) return s;
      if (a && prompt && a.key === prompt.key && a.text === prompt.text && a.passive === prompt.passive) return s;
      return { prompt };
    }),
  setInfo: (info) => set({ info }),
  setNotice: (text) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    if (!text) {
      set({ notice: null });
      return;
    }
    set({ notice: { text, at: Date.now() } });
    noticeTimer = setTimeout(() => set({ notice: null }), 2800);
  },
  setSitting: (sitting) => set({ sitting }),
  setElevatorPicker: (elevatorPicker) => set({ elevatorPicker }),
  setRiding: (riding) => set({ riding }),
  setNavOpen: (navOpen) => set({ navOpen, floorsOpen: navOpen ? false : get().floorsOpen, settingsOpen: navOpen ? false : get().settingsOpen }),
  setFloorsOpen: (floorsOpen) => set({ floorsOpen, navOpen: floorsOpen ? false : get().navOpen, settingsOpen: floorsOpen ? false : get().settingsOpen }),
  setNavTarget: (navTarget) => set({ navTarget }),
  bumpRoute: () => set((s) => ({ routeNonce: s.routeNonce + 1 })),
  finishExit: () =>
    set({
      phase: 'off',
      paused: false,
      immersive: false,
      hintVisible: false,
      location: emptyLocation(),
      prompt: null,
      info: null,
      sitting: null,
      elevatorPicker: null,
      riding: false,
      navOpen: false,
      floorsOpen: false,
      settingsOpen: false,
      navTarget: null,
      designView: false,
    }),
}));

/** Non-reactive check used by keyboard handlers outside React. */
export function walkthroughActive(): boolean {
  return useWalkthroughStore.getState().phase !== 'off';
}
