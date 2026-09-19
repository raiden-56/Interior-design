"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Layers,
  Undo2,
  Redo2,
  Download,
  Upload,
  Share2,
  Sparkles,
  Box,
  Camera,
  Compass,
  Eye,
  Save,
  Check,
  X,
  CircleHelp,
  Focus,
  Cloud,
  CloudOff,
  HardDrive,
  Loader2,
} from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import { useUiStore } from "@/stores/ui-store";
import {
  downloadProject,
  parseProjectFile,
  readFileAsText,
  saveProjectLocal,
} from "@/lib/storage";
import { captureActive } from "@/lib/capture";
import { cn } from "@/lib/cn";

const CAMERAS: {
  id: "persp" | "top" | "iso" | "front";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "persp", label: "Perspective", Icon: Camera },
  { id: "top", label: "Top-down", Icon: Box },
  { id: "iso", label: "Isometric", Icon: Compass },
  { id: "front", label: "Front", Icon: Eye },
];

const LIGHTS: {
  id: "daylight" | "evening" | "warm" | "studio";
  label: string;
}[] = [
  { id: "daylight", label: "Daylight" },
  { id: "evening", label: "Evening" },
  { id: "warm", label: "Warm" },
  { id: "studio", label: "Studio" },
];

export function TopBar() {
  const router = useRouter();
  const project = useEditorStore((s) => s.project);
  const view = useEditorStore((s) => s.view);
  const canUndo = useEditorStore((s) => s.history.index >= 0);
  const canRedo = useEditorStore(
    (s) => s.history.index < s.history.entries.length - 1,
  );
  const undoLabel = useEditorStore((s) =>
    s.history.index >= 0 ? s.history.entries[s.history.index]?.label : null,
  );
  const redoLabel = useEditorStore(
    (s) => s.history.entries[s.history.index + 1]?.label ?? null,
  );
  const dirty = useEditorStore((s) => s.dirty);
  const syncState = useEditorStore((s) => s.syncState);
  const toggleAi = useUiStore((s) => s.toggleAi);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const cameraPreset = useUiStore((s) => s.cameraPreset);
  const setCameraPreset = useUiStore((s) => s.setCameraPreset);
  const requestCameraFit = useUiStore((s) => s.requestCameraFit);
  const renderPreset = useUiStore((s) => s.renderPreset);
  const setRenderPreset = useUiStore((s) => s.setRenderPreset);
  const transformMode = useUiStore((s) => s.transformMode);
  const setTransformMode = useUiStore((s) => s.setTransformMode);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setView = useEditorStore((s) => s.setView);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const saveNow = useEditorStore((s) => s.saveNow);
  const updateProjectInfo = useEditorStore((s) => s.updateProjectInfo);
  const pushToast = useEditorStore((s) => s.pushToast);
  const editor2D = useEditorStore((s) => s.editor2D);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const handleSave = async () => {
    await saveNow();
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
    pushToast(
      useEditorStore.getState().backendLive
        ? "Saved and synced"
        : "Saved in this browser",
      "success",
    );
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/editor/${project.id}`;
    // Make sure the link resolves for whoever receives it.
    await saveNow();
    const synced = useEditorStore.getState().backendLive;
    try {
      await navigator.clipboard.writeText(url);
      pushToast(
        synced
          ? "Link copied — opens on any device"
          : "Link copied (backend offline: opens only in this browser)",
        synced ? "success" : "info",
      );
    } catch {
      pushToast("Could not copy link", "error");
    }
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = parseProjectFile(await readFileAsText(file));
      saveProjectLocal(imported);
      pushToast(`Imported "${imported.name}"`, "success");
      router.push(`/editor/${imported.id}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800 bg-[#0d1016] px-3">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold text-zinc-100 hover:bg-zinc-800/60"
        title="All projects"
      >
        <span className="grid h-6 w-6 place-items-center rounded bg-gradient-to-br from-sky-500 to-indigo-600 text-[11px] text-white">
          <Layers className="h-3.5 w-3.5" />
        </span>
        <span className="hidden sm:inline">Interior Studio</span>
      </Link>

      <div className="mx-1 h-5 w-px bg-zinc-800" />

      <input
        value={project.name}
        onChange={(e) => updateProjectInfo({ name: e.target.value })}
        onBlur={(e) => {
          if (!e.target.value.trim())
            updateProjectInfo({ name: "Untitled Project" });
        }}
        className="w-40 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-zinc-100 outline-none hover:border-zinc-700 focus:border-sky-500/60"
        spellCheck={false}
        aria-label="Project name"
      />

      <div className="flex-1" />

      {/* View + camera controls */}
      <div className="flex items-center">
        <div className="flex items-center rounded-lg border border-zinc-700/70 bg-zinc-900 p-0.5">
          <SegBtn
            active={view === "2d"}
            onClick={() => setView("2d")}
            title="Floor plan (1)"
          >
            Plan
          </SegBtn>
          <SegBtn
            active={view === "3d"}
            onClick={() => setView("3d")}
            title="3D view (2)"
          >
            3D
          </SegBtn>
        </div>

        {view === "2d" && (
          <button
            onClick={() => editor2D?.fitView()}
            className="ml-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            title="Fit drawing (F)"
          >
            <Focus className="h-4 w-4" />
            <span className="hidden lg:inline">Fit</span>
          </button>
        )}

        {view === "3d" && (
          <div className="ml-2 flex items-center gap-1">
            {CAMERAS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                onClick={() => setCameraPreset(c.id)}
                className={cn(
                  "rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  cameraPreset === c.id && "bg-zinc-800 text-sky-400",
                )}
              >
                <c.Icon className="h-4 w-4" />
              </button>
            ))}
            <button
              onClick={requestCameraFit}
              title="Fit whole scene (F)"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Focus className="h-4 w-4" />
            </button>
            <select
              value={renderPreset}
              onChange={(e) =>
                setRenderPreset(e.target.value as (typeof LIGHTS)[number]["id"])
              }
              className="ml-1 h-7 rounded-md border border-zinc-700/70 bg-zinc-900 px-1.5 text-[11px] text-zinc-300 outline-none"
              title="Lighting"
            >
              {LIGHTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <div className="ml-1 flex items-center rounded-lg border border-zinc-700/70 bg-zinc-900 p-0.5">
              {(["translate", "rotate", "scale"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTransformMode(m)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium capitalize text-zinc-400 hover:bg-zinc-800",
                    transformMode === m && "bg-zinc-800 text-sky-400",
                  )}
                  title={
                    m === "translate"
                      ? "Move selected furniture"
                      : m === "rotate"
                        ? "Rotate selected furniture"
                        : "Scale selected furniture"
                  }
                >
                  {m === "translate"
                    ? "Move"
                    : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mx-2 h-5 w-px bg-zinc-800" />

      {/* History */}
      <div className="flex items-center gap-0.5">
        <IconBtn
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo"}
          disabled={!canUndo}
          onClick={() => undo()}
        >
          <Undo2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          title={
            redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"
          }
          disabled={!canRedo}
          onClick={() => redo()}
        >
          <Redo2 className="h-4 w-4" />
        </IconBtn>
      </div>

      <div className="mx-1 h-5 w-px bg-zinc-800" />

      {/* Save state */}
      <button
        onClick={handleSave}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        title="Save now (Ctrl+S) — changes are also saved automatically"
      >
        {savedFlash ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        <SyncLabel state={syncState} dirty={dirty} />
      </button>

      <div className="mx-1 h-5 w-px bg-zinc-800" />

      {/* Export / import */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setExportOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800"
          title="Export or import"
        >
          <Download className="h-4 w-4" />
          <span className="hidden text-xs md:inline">Export</span>
        </button>
        {exportOpen && (
          <div className="absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-sm shadow-2xl">
            <MenuItem
              onClick={() => {
                void captureActive();
                setExportOpen(false);
              }}
            >
              <Camera className="h-3.5 w-3.5" /> PNG snapshot (
              {view === "3d" ? "3D view" : "floor plan"})
            </MenuItem>
            <MenuItem
              onClick={() => {
                downloadProject(project);
                setExportOpen(false);
              }}
            >
              <Download className="h-3.5 w-3.5" /> Download project (.json)
            </MenuItem>
            <div className="my-1 h-px bg-zinc-800" />
            <MenuItem
              onClick={() => {
                fileRef.current?.click();
                setExportOpen(false);
              }}
            >
              <Upload className="h-3.5 w-3.5" /> Import project (.json)…
            </MenuItem>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void handleImport(e.target.files?.[0])}
        />
      </div>

      <button
        onClick={handleShare}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800"
        title="Copy a link to this project"
      >
        <Share2 className="h-4 w-4" />
      </button>

      <button
        onClick={() => setShortcutsOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800"
        title="Help & shortcuts (?)"
      >
        <CircleHelp className="h-4 w-4" />
      </button>

      {/* <button
        onClick={toggleAi}
        className={cn('flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500', aiOpen && 'opacity-80')}
        title="AI Assistant (Ctrl+K)"
      >
        <Sparkles className="h-4 w-4" />
        {aiOpen ? <X className="h-3.5 w-3.5" /> : <span className="hidden md:inline">AI</span>}
      </button> */}
    </header>
  );
}

function SyncLabel({ state, dirty }: { state: string; dirty: boolean }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-zinc-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (dirty) return <span className="text-zinc-400">Unsaved changes</span>;
  if (state === "synced") {
    return (
      <span className="flex items-center gap-1 text-emerald-400">
        <Cloud className="h-3 w-3" /> Synced
      </span>
    );
  }
  if (state === "local") {
    return (
      <span
        className="flex items-center gap-1 text-zinc-400"
        title="The backend is not reachable — saved in this browser only"
      >
        <HardDrive className="h-3 w-3" /> Saved locally
      </span>
    );
  }
  if (state === "offline") {
    return (
      <span className="flex items-center gap-1 text-amber-400">
        <CloudOff className="h-3 w-3" /> Offline
      </span>
    );
  }
  return <span className="text-zinc-400">Saved</span>;
}

function SegBtn({
  active,
  onClick,
  title,
  children,
}: React.PropsWithChildren<{
  active: boolean;
  onClick: () => void;
  title?: string;
}>) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100",
        active && "bg-sky-600/20 text-sky-300",
      )}
    >
      {children}
    </button>
  );
}

function IconBtn({
  title,
  disabled,
  onClick,
  children,
}: React.PropsWithChildren<{
  title: string;
  disabled?: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function MenuItem({
  onClick,
  children,
}: React.PropsWithChildren<{ onClick: () => void }>) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
