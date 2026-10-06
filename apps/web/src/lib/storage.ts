import type { Project } from '@interior/core';

const KEY = 'interior.projects.v1';

/**
 * Persistence layer.
 *
 * - localStorage is the source of truth for the current browser (offline-first).
 * - The FastAPI backend, when reachable, mirrors every project keyed on the
 *   *client* id, so the same project can be opened from any device and a
 *   shared `/editor/<id>` link actually resolves elsewhere.
 * - A backend that is down never blocks editing; sync simply resumes later.
 *
 * The previous implementation created a brand-new server project (fresh uuid)
 * on every push and only pushed at project creation, so edits never reached
 * the server and each save left a duplicate row behind.
 */

/**
 * Project traffic goes through the app's own authenticated proxy
 * (`/api/backend/*`), which attaches the storage service's credential
 * server-side. Point `NEXT_PUBLIC_API_BASE` at the service directly only for
 * local debugging — doing it in production puts the store on the internet.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '/api/backend').replace(/\/$/, '');

/**
 * A client opening a share link has no session, so their read is authorised by
 * the token itself. The viewer route sets it before loading the project.
 */
let shareToken: string | null = null;

export function setShareToken(token: string | null): void {
  shareToken = token;
}

// --- local -------------------------------------------------------------------

export function listProjectsLocal(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    return parsed.filter(isProjectShaped).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getProjectLocal(projectId: string): Project | null {
  return listProjectsLocal().find((p) => p.id === projectId) ?? null;
}

export function saveProjectLocal(project: Project): void {
  const all = listProjectsLocal().filter((p) => p.id !== project.id);
  all.push(project);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (err) {
    // Quota exceeded is the realistic failure; surface it rather than lose work silently.
    console.error('[storage] could not write to localStorage', err);
    throw new Error('Browser storage is full — export the project as JSON to keep a copy.');
  }
}

export function deleteProjectLocal(projectId: string): void {
  localStorage.setItem(KEY, JSON.stringify(listProjectsLocal().filter((p) => p.id !== projectId)));
}

/** Minimal structural check so a corrupt entry can't crash the dashboard. */
export function isProjectShaped(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Project>;
  return typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.floors) && p.floors.length > 0;
}

// --- import / export -----------------------------------------------------------

/** Download a JSON file of the project. */
export function downloadProject(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${slugify(project.name)}.json`);
}

/**
 * Parses a previously exported project file. Returns a project with a fresh
 * id (so importing a file never overwrites an existing project) and a
 * bumped timestamp so it sorts to the top of the dashboard.
 */
export function parseProjectFile(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isProjectShaped(data)) {
    throw new Error('That file is not an Interior Studio project export.');
  }
  return {
    ...data,
    id: 'project-' + Math.random().toString(36).slice(2, 10),
    updatedAt: Date.now(),
  };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsText(file);
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, 'image/png');
}

// --- backend -------------------------------------------------------------------

interface RemoteProject {
  id: string;
  name: string;
  units: Project['units'];
  floorHeight: number;
  scene: { floors?: Project['floors']; floorHeight?: number; units?: string; walkthrough?: Project['walkthrough'] } | null;
  updatedAt: number;
}

const HEALTH_TTL_MS = 10_000;
let healthCache: { at: number; ok: boolean } | null = null;

/**
 * Cached reachability probe. Autosave fires every few hundred milliseconds
 * while someone drags a slider, and a health ping per save would spam a
 * server that's down with connection attempts.
 */
export async function backendOnline(force = false): Promise<boolean> {
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.ok;
  let ok = false;
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(2500),
      headers: shareToken ? { 'x-share-token': shareToken } : undefined,
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  healthCache = { at: Date.now(), ok };
  return ok;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(shareToken ? { 'x-share-token': shareToken } : {}),
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Upsert the project on the backend under its own id. Resolves false when the backend is unreachable. */
export async function remoteSave(project: Project): Promise<boolean> {
  if (!(await backendOnline())) return false;
  try {
    await request(`/projects/${encodeURIComponent(project.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: project.name,
        units: project.units,
        floorHeight: project.floorHeight,
        scene: projectToScene(project),
        updatedAt: project.updatedAt,
      }),
    });
    return true;
  } catch (err) {
    console.warn('[storage] remote save failed', err);
    healthCache = null;
    return false;
  }
}

export async function remoteGet(projectId: string): Promise<Project | null> {
  if (!(await backendOnline())) return null;
  try {
    const remote = await request<RemoteProject>(`/projects/${encodeURIComponent(projectId)}`);
    return remoteToProject(remote);
  } catch {
    return null;
  }
}

export async function remoteList(): Promise<Project[]> {
  if (!(await backendOnline())) return [];
  try {
    const list = await request<RemoteProject[]>('/projects');
    return list.map(remoteToProject).filter((p): p is Project => p !== null);
  } catch {
    return [];
  }
}

export async function remoteDelete(projectId: string): Promise<boolean> {
  if (!(await backendOnline())) return false;
  try {
    await request(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Local ∪ remote, newest `updatedAt` wins per id. Remote-only projects are
 * written into the local cache so the editor route can open them without a
 * second round-trip, and local-only ones are pushed up.
 */
export async function syncProjectList(): Promise<{ projects: Project[]; online: boolean }> {
  const local = listProjectsLocal();
  const online = await backendOnline(true);
  if (!online) return { projects: local, online: false };

  const remote = await remoteList();
  const byId = new Map<string, Project>();
  for (const p of local) byId.set(p.id, p);
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.updatedAt > l.updatedAt) byId.set(r.id, r);
  }

  const merged = Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  const remoteIds = new Set(remote.map((r) => r.id));

  for (const p of merged) {
    const l = local.find((x) => x.id === p.id);
    if (!l || l.updatedAt < p.updatedAt) saveProjectLocal(p);
    if (!remoteIds.has(p.id) || (l && l.updatedAt > (remote.find((r) => r.id === p.id)?.updatedAt ?? 0))) {
      void remoteSave(p);
    }
  }
  return { projects: merged, online: true };
}

function remoteToProject(remote: RemoteProject): Project | null {
  const floors = remote.scene?.floors;
  if (!Array.isArray(floors) || floors.length === 0) return null;
  return {
    id: remote.id,
    name: remote.name,
    units: (remote.scene?.units as Project['units']) ?? remote.units ?? 'meters',
    floorHeight: remote.scene?.floorHeight ?? remote.floorHeight ?? 3,
    floors,
    updatedAt: remote.updatedAt || 0,
    ...(remote.scene?.walkthrough ? { walkthrough: remote.scene.walkthrough } : {}),
  };
}

/** Compact scene payload for the backend (single JSON column on the project). */
export function projectToScene(project: Project): unknown {
  return {
    version: 1,
    floors: project.floors,
    floorHeight: project.floorHeight,
    units: project.units,
    // Spawn points ride along in the same JSON column; the backend never
    // looks inside `scene`, so no server change is needed.
    ...(project.walkthrough ? { walkthrough: project.walkthrough } : {}),
  };
}

/** Kept for callers that already hold a backend project shell. */
export function sceneToProject(
  project: Project,
  scene: { floors?: unknown; floorHeight?: number; units?: string; walkthrough?: Project['walkthrough'] },
): Project {
  return {
    ...project,
    units: (scene.units as Project['units']) ?? project.units,
    floorHeight: scene.floorHeight ?? project.floorHeight,
    floors: (scene.floors as Project['floors'])?.length ? (scene.floors as Project['floors']) : project.floors,
    ...(scene.walkthrough ? { walkthrough: scene.walkthrough } : {}),
  };
}
