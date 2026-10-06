import { create } from 'zustand';

export type CameraPreset = 'persp' | 'top' | 'iso' | 'front';
export type RenderPreset = 'daylight' | 'evening' | 'warm' | 'studio' | 'night';
export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface AiPendingApply {
  summary: string;
  elements: { command: import('@interior/core').Command; label: string }[];
}

export interface PendingAsset {
  assetId: string;
  name: string;
  shape: string;
  width: number;
  depth: number;
  height: number;
  color: string | null;
  /** Wall/ceiling piece: hangs above the floor and skips floor clearance checks. */
  mounted?: boolean;
}

/** Reported by the backend's /ai/status; null until probed. */
export interface AiEngineInfo {
  enabled: boolean;
  model: string;
}

interface UiState {
  leftOpen: boolean;
  rightOpen: boolean;
  aiOpen: boolean;
  leftTab: 'furniture' | 'walls' | 'materials';
  aiPending: AiPendingApply | null;
  measureWidget: { from: { x: number; y: number } | null; to: { x: number; y: number } | null; active: boolean };
  cameraPreset: CameraPreset;
  /** Bumped on every preset click so re-selecting the active preset re-frames the scene. */
  cameraNonce: number;
  renderPreset: RenderPreset;
  transformMode: TransformMode;
  toastsHidden: boolean;
  pendingAsset: PendingAsset | null;
  shortcutsOpen: boolean;
  aiEngine: AiEngineInfo | null;
  /** Next click in the 3D view places a walkthrough start point. */
  pendingSpawn: boolean;
  /**
   * Space is held down: every canvas temporarily pans on a left-drag.
   * Kept here rather than swapping the active tool, so releasing Space can
   * never strand the user in the pan tool, and so the 3D view can honour it
   * too (it has no concept of the 2D tool set).
   */
  spaceHeld: boolean;
  /**
   * Live Blender-style transform (G/R/S). Rendered as a read-out over the
   * canvas, which cannot live inside the WebGL tree.
   */
  modalTransform: { mode: 'translate' | 'rotate' | 'scale'; axis: 'x' | 'z' | null; typed: string; readout: string } | null;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleAi: () => void;
  setLeftTab: (t: UiState['leftTab']) => void;
  setAiPending: (p: AiPendingApply | null) => void;
  setMeasure: (m: Partial<UiState['measureWidget']>) => void;
  setCameraPreset: (p: CameraPreset) => void;
  /** Re-frame the 3D view around the whole scene. */
  requestCameraFit: () => void;
  setRenderPreset: (p: RenderPreset) => void;
  setTransformMode: (m: TransformMode) => void;
  setPendingAsset: (p: PendingAsset | null) => void;
  setShortcutsOpen: (open: boolean) => void;
  setAiEngine: (info: AiEngineInfo | null) => void;
  setSpaceHeld: (held: boolean) => void;
  setModalTransform: (t: UiState['modalTransform']) => void;
  setPendingSpawn: (v: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  leftOpen: true,
  rightOpen: true,
  aiOpen: false,
  leftTab: 'furniture',
  aiPending: null,
  measureWidget: { from: null, to: null, active: false },
  cameraPreset: 'persp',
  cameraNonce: 0,
  renderPreset: 'daylight',
  transformMode: 'translate',
  toastsHidden: false,
  pendingAsset: null,
  shortcutsOpen: false,
  aiEngine: null,
  spaceHeld: false,
  modalTransform: null,
  pendingSpawn: false,

  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen, aiPending: null })),
  setLeftTab: (t) => set({ leftTab: t }),
  setAiPending: (p) => set({ aiPending: p }),
  setMeasure: (m) => set((s) => ({ measureWidget: { ...s.measureWidget, ...m } })),
  setCameraPreset: (p) => set((s) => ({ cameraPreset: p, cameraNonce: s.cameraNonce + 1 })),
  requestCameraFit: () => set((s) => ({ cameraPreset: 'persp', cameraNonce: s.cameraNonce + 1 })),
  setRenderPreset: (p) => set({ renderPreset: p }),
  setTransformMode: (m) => set({ transformMode: m }),
  setPendingAsset: (p) => set({ pendingAsset: p }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setAiEngine: (info) => set({ aiEngine: info }),
  setSpaceHeld: (held) => set((s) => (s.spaceHeld === held ? s : { spaceHeld: held })),
  setModalTransform: (t) => set({ modalTransform: t }),
  setPendingSpawn: (v) => set({ pendingSpawn: v }),
}));
