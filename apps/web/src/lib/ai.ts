import type { Floor, Project, ProjectObject, Room, Vec2, Wall, Command } from '@interior/core';
import { polygonCentroid, polygonArea, pointOnWall, wallLength, wallDir, deg, rad } from '@interior/core';
import { keywordToAssets, assetById, FURNITURE_LIBRARY } from './furniture';
import { API_BASE } from './storage';

/**
 * AI Assistant engine (Phase 4 — structured command generation).
 *
 * The backend AI gateway is replaced by a deterministic intent parser for now,
 * but the output contract is identical: an ordered list of structured commands
 * that are PREVIEWED and CONFIRMED by the user before execution. Nothing is
 * applied destructively without confirmation.
 */

export interface AiAction {
  id: string;
  summary: string;
  commands: { command: Command; label: string }[];
  severity: 'info' | 'warning';
}

export function planAi(prompt: string, project: Project, floor: Floor): AiAction[] {
  const actions: AiAction[] = [];
  const text = prompt.toLowerCase().trim();

  const colorResult = findColor(text);
  const room = largestRoom(floor);

  // 1) "make NNNN / walls to X / color" — recolor walls
  if (colorResult && /(make|color|paint|wall).*?(modern|minimal|luxury|scandi|industrial|traditional|cosy|warm|grey|gray|beige|white|blue|green|navy|charcoal|black|terracotta|blush|ivory|sage|wood)/i.test(text)) {
    const cmds = floor.walls.map((w) => ({ command: { type: 'UPDATE_WALL', id: w.id, patch: { color: colorResult.hex } } as Command, label: `Paint wall to ${colorResult.name}` }));
    if (cmds.length) actions.push(newAction(`Paint ${cmds.length} wall${cmds.length > 1 ? 's' : ''} ${colorResult.name}`, cmds));
  }

  // 2) add / put / place furniture
  const addMatch = text.match(/\b(add|put|place|create|get)\s+(?:an?\s+|the\s+|some\s+)?([a-z][a-z -]*?)(?:\s+(?:in|to|near|beside|behind|by)\s+(?:the\s+|my\s+)?(living room|living|bedroom|kitchen|bathroom|dining|office))?(?:\.|$|\s+(?:and|also))/);
  if (addMatch && /(sofa|couch|chair|table|bed|lamp|plant|wardrobe|tv|bookshelf|rug|desk|fridge|sink|toilet|stool|otm|ottoman|armchair|television)/.test(addMatch[2])) {
    const assetIds = keywordToAssets[addMatch[2]] ?? keywordToAssets[addMatch[2].split(' ')[0]] ?? [];
    for (const assetId of assetIds) {
      const asset = assetById(assetId);
      if (!asset) continue;
      const placement = choosePlacement(floor, asset.width, asset.depth, room);
      const obj: ProjectObject = {
        id: 'obj-' + Math.random().toString(36).slice(2, 9),
        assetId: asset.id,
        name: asset.name,
        shape: asset.shape,
        x: placement.x,
        z: placement.y,
        rotation: placement.rotation,
        scale: 1,
        width: asset.width,
        depth: asset.depth,
        height: asset.height,
        color: colorResult && /(sofa|couch|chair|bed|rug|ottoman)/.test(addMatch[2]) ? colorResult.hex : asset.color,
        materialId: null,
        ...(asset.mounted ? { metadata: { mounted: true } } : {}),
      };
      actions.push(newAction(`Add ${colorResult && /(sofa|couch|chair|bed|rug|ottoman)/.test(addMatch[2]) ? colorResult.name + ' ' : ''}${asset.name}`, [
        { command: { type: 'ADD_OBJECT', object: obj }, label: `Place ${asset.name}` },
      ]));
    }
  }

  // 3) move existing objects near window / door / center
  const moveMatch = text.match(/\b(move|push|slide|place|drag)\s+(?:the\s+|my\s+)?([a-z][a-z -]*?)\s+(?:to|near|beside|next to|into)\s+(?:the\s+|my\s+)?(window|door|corner|center|centre)/);
  if (moveMatch) {
    const tgt = findObjectsByKeyword(floor, moveMatch[2]);
    for (const obj of tgt) {
      const pos = destinationFor(floor, obj, moveMatch[3], room);
      if (!pos) continue;
      actions.push(newAction(`Move "${obj.name}" near the ${moveMatch[3]}`, [
        { command: { type: 'UPDATE_OBJECT', id: obj.id, patch: { x: pos.x, z: pos.y, rotation: pos.rotation } }, label: `Reposition ${obj.name}` },
      ]));
    }
  }

  // 4) recolor a specific object (e.g. "blue sofa")
  const recolorObj = text.match(/\b(make|paint|turn|color|change)\s+(?:the\s+|my\s+)?([a-z][a-z -]*?)\s+(color\s+)?(to\s+)?([a-z]+)/);
  if (colorResult && recolorObj) {
    const objs = findObjectsByKeyword(floor, recolorObj[2]);
    for (const obj of objs) {
      actions.push(newAction(`Recolor "${obj.name}" ${colorResult.name}`, [
        { command: { type: 'UPDATE_OBJECT', id: obj.id, patch: { color: colorResult.hex } }, label: `${obj.name} → ${colorResult.name}` },
      ]));
    }
  }

  // 5) remove / delete furniture
  const delMatch = text.match(/\b(remove|delete|clear|take out|get rid of)\s+(?:the\s+|my\s+|all\s+)?([a-z][a-z -]*?)(?:\s+(?:from|in)\s+(?:the\s+|my\s+)?room)?$/);
  if (delMatch && delMatch[2] !== 'everything') {
    const objs = findObjectsByKeyword(floor, delMatch[2]);
    for (const obj of objs) {
      actions.push(newAction(`Remove "${obj.name}"`, [
        { command: { type: 'DELETE_OBJECT', id: obj.id }, label: `Delete ${obj.name}` },
      ]));
    }
  }

  // 6) style directive — propose a palette and re-style existing furniture
  const styleMatch = text.match(/\b(make|design|create|restyle|turn)\s+(?:this\s+|the\s+|my\s+)?(room|space|interior|bedroom|living\s*room|kitchen)\s+([a-z]+)/);
  if (styleMatch) {
    const style = styleMatch[3];
    const palette = STYLE_PALETTES[style as keyof typeof STYLE_PALETTES];
    if (palette) {
      const cmds: { command: Command; label: string }[] = [];
      for (const w of floor.walls.slice(0, 6)) {
        cmds.push({ command: { type: 'UPDATE_WALL', id: w.id, patch: { color: palette.wall } }, label: `Wall → ${palette.wallLabel}` });
      }
      for (const o of floor.objects.slice(0, 4)) {
        cmds.push({ command: { type: 'UPDATE_OBJECT', id: o.id, patch: { color: palette.accent } }, label: `${o.name} → ${palette.accentLabel}` });
      }
      actions.push(newAction(`Apply ${style} style (${palette.wallLabel} walls, ${palette.accentLabel} accents)`, cmds));
    }
  }

  // 7) explicit "walls to <color>" without furniture context
  if (colorResult && /wall(s|s)\s+(to|in|painted)?/i.test(text) && !actions.some((a) => a.summary.includes('wall'))) {
    const cmds = floor.walls.map((w) => ({ command: { type: 'UPDATE_WALL', id: w.id, patch: { color: colorResult.hex } } as Command, label: `Paint wall ${colorResult.name}` }));
    if (cmds.length) actions.push(newAction(`Paint all walls ${colorResult.name}`, cmds));
  }

  return actions;
}

// --- helpers ----------------------------------------------------------------

let aiCounter = 0;
function newAction(summary: string, commands: { command: Command; label: string }[], severity: 'info' | 'warning' = 'info'): AiAction {
  aiCounter += 1;
  return { id: `ai-${aiCounter}`, summary, commands, severity };
}

const NAMED_COLORS: Record<string, { hex: string; name: string }> = {
  white: { hex: '#f4f4f3', name: 'white' },
  ivory: { hex: '#efead8', name: 'ivory' },
  beige: { hex: '#d9cbb3', name: 'warm beige' },
  grey: { hex: '#8a8d91', name: 'grey' },
  gray: { hex: '#8a8d91', name: 'grey' },
  greige: { hex: '#a99f8f', name: 'greige' },
  blue: { hex: '#3f5f7f', name: 'blue' },
  navy: { hex: '#2e3c50', name: 'navy' },
  black: { hex: '#3c3f44', name: 'charcoal' },
  charcoal: { hex: '#3c3f44', name: 'charcoal' },
  green: { hex: '#a3ad91', name: 'sage green' },
  sage: { hex: '#a3ad91', name: 'sage green' },
  brown: { hex: '#6f4e37', name: 'walnut brown' },
  wood: { hex: '#9a6b3a', name: 'teak' },
  terracotta: { hex: '#b96a4b', name: 'terracotta' },
  blush: { hex: '#d8b4ac', name: 'blush' },
  yellow: { hex: '#d8a24a', name: 'ochre yellow' },
  red: { hex: '#a04a3a', name: 'warm red' },
};

function findColor(text: string): { hex: string; name: string } | null {
  const hexMatch = text.match(/#([0-9a-f]{6}|[0-9a-f]{3})/i);
  if (hexMatch) return { hex: `#${hexMatch[1]}`, name: hexMatch[1] };
  for (const key of Object.keys(NAMED_COLORS)) {
    if (new RegExp(`\\b${key}\\b`).test(text)) return NAMED_COLORS[key];
  }
  return null;
}

function largestRoom(floor: Floor): Room | null {
  let best: Room | null = null;
  let bestArea = -1;
  for (const r of floor.rooms) {
    if (r.points.length >= 3) {
      const a = Math.abs(polygonArea(r.points));
      if (a > bestArea) {
        bestArea = a;
        best = r;
      }
    }
  }
  return best;
}

function choosePlacement(floor: Floor, w: number, d: number, room: Room | null): { x: number; y: number; rotation: number } {
  const c = room ? polygonCentroid(room.points) : { x: 0, y: 0 };
  // Try to avoid overlapping the room centerline footprint with a wall.
  const win = floor.windows[0];
  if (win) {
    const wall = floor.walls.find((wl) => wl.id === win.wallId);
    if (wall && wallLength(wall) > 0) {
      const dir = wallDir(wall);
      const px = -dir.y;
      const py = dir.x;
      const at = pointOnWall(wall, Math.min(Math.max(win.offset + win.width / 2, 0.1), wallLength(wall)));
      return {
        x: at.x + px * (d / 2 + 0.3),
        y: at.y + py * (d / 2 + 0.3),
        rotation: Math.atan2(dir.y, dir.x) + Math.PI / 2,
      };
    }
  }
  return { x: c.x, y: c.y, rotation: rad(0) };
}

function destinationFor(floor: Floor, obj: ProjectObject, target: string, room: Room | null): { x: number; y: number; rotation: number } | null {
  if (target === 'center' || target === 'centre') {
    const c = room ? polygonCentroid(room.points) : { x: obj.x, y: obj.z };
    return { x: c.x, y: c.y, rotation: obj.rotation };
  }
  const anchor = target === 'door' ? floor.doors[0] : floor.windows[0];
  if (!anchor) return null;
  const wall = floor.walls.find((wl) => wl.id === anchor.wallId);
  if (!wall) return null;
  const dir = wallDir(wall);
  const offset = target === 'door' ? anchor.offset + anchor.width / 2 : anchor.offset + anchor.width / 2;
  const at = pointOnWall(wall, Math.min(Math.max(offset, 0.1), wallLength(wall)));
  const d = (anchor as { width: number }).width;
  return {
    x: at.x - dir.y * (obj.depth / 2 + Math.min(d / 2 + 0.3, 0.9)),
    y: at.y + dir.x * (obj.depth / 2 + Math.min(d / 2 + 0.3, 0.9)),
    rotation: Math.atan2(dir.y, dir.x) + Math.PI / 2,
  };
}

function findObjectsByKeyword(floor: Floor, keyword: string): ProjectObject[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw || kw === 'the') return [];
  const tokens = kw.split(/\s+/).filter((t) => t.length > 1);
  const matches = keywordToAssets[kw] ?? [];
  const wantedShapes = new Set<string>();
  for (const id of matches) {
    const a = assetById(id);
    if (a) wantedShapes.add(a.shape);
  }
  return floor.objects.filter((o) => {
    if (wantedShapes.has(o.shape)) return true;
    const n = o.name.toLowerCase();
    return tokens.some((t) => n.includes(t));
  });
}

const STYLE_PALETTES: Record<string, { wall: string; wallLabel: string; accent: string; accentLabel: string }> = {
  modern: { wall: '#d9cbb3', wallLabel: 'warm beige', accent: '#4a90a4', accentLabel: 'teal' },
  minimal: { wall: '#f4f4f3', wallLabel: 'matte white', accent: '#8a8d91', accentLabel: 'grey' },
  luxury: { wall: '#a99f8f', wallLabel: 'greige', accent: '#c59f54', accentLabel: 'brass' },
  scandi: { wall: '#efead8', wallLabel: 'ivory', accent: '#a3ad91', accentLabel: 'olive' },
  scandinavian: { wall: '#efead8', wallLabel: 'ivory', accent: '#a3ad91', accentLabel: 'olive' },
  industrial: { wall: '#3c3f44', wallLabel: 'charcoal', accent: '#aab0b6', accentLabel: 'steel' },
  traditional: { wall: '#d9cbb3', wallLabel: 'beige', accent: '#6f4e37', accentLabel: 'walnut' },
  whimsical: { wall: '#a3ad91', wallLabel: 'sage green', accent: '#d8b4ac', accentLabel: 'blush' },
};

export const SUGGESTED_PROMPTS = [
  'Add a grey sofa near the window',
  'Make this room modern',
  'Paint the walls warm beige',
  'Add a coffee table and a floor lamp',
  'Move the dining table near the window',
  'Apply a luxury style',
  'Add a queen bed and nightstands',
  'Make the sofa terracotta',
];

export function describePlacementDeg(rotation: number): string {
  return `${deg(rotation).toFixed(0)}°`;
}

/** Keep a reference to the full library so the panel can show a placeholder picker. */
export const FURNITURE_BY_CATEGORY = FURNITURE_LIBRARY;
export type { Wall }; // re-export for panels referencing wall props

// --- backend (Claude) planner ------------------------------------------------

export interface AiPlanResult {
  actions: AiAction[];
  /** 'rules' for the built-in parser, otherwise the model id that answered. */
  engine: string;
  note?: string;
}

interface AiStatusResponse {
  enabled: boolean;
  model: string;
}

/** Asks the backend whether a Claude-backed planner is configured. Null when the backend is unreachable. */
export async function fetchAiStatus(): Promise<AiStatusResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/ai/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return (await res.json()) as AiStatusResponse;
  } catch {
    return null;
  }
}

/**
 * Plans with the backend model when it is configured, otherwise with the
 * local rules. Either way the result is the same previewable command list,
 * and nothing is applied until the user confirms in the panel.
 */
export async function planAiSmart(prompt: string, project: Project, floor: Floor, useBackend: boolean): Promise<AiPlanResult> {
  if (useBackend) {
    try {
      const res = await fetch(`${API_BASE}/ai/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          activeFloorId: floor.id,
          project: { ...project, _catalog: catalogSummary() },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) {
        const data = (await res.json()) as { actions: Array<{ id: string; summary: string; severity: string; commands: Array<{ label: string; command: Command }> }>; engine: string; note?: string };
        const actions: AiAction[] = data.actions.map((a, i) => ({
          id: a.id || `ai-${i + 1}`,
          summary: a.summary,
          severity: a.severity === 'warning' ? 'warning' : 'info',
          commands: a.commands,
        }));
        // A model that found nothing still leaves the rules a chance.
        if (actions.length > 0) return { actions, engine: data.engine, note: data.note };
        const fallback = planAi(prompt, project, floor);
        return { actions: fallback, engine: fallback.length ? 'rules' : data.engine, note: data.note };
      }
      // 503 = not configured, 429/502 = provider trouble: fall through to rules.
    } catch {
      // Network problem: fall through to rules.
    }
  }
  return { actions: planAi(prompt, project, floor), engine: 'rules' };
}

/** Compact catalog the model can pick assets from — ids, shapes and true dimensions. */
function catalogSummary() {
  return FURNITURE_LIBRARY.map((a) => ({
    assetId: a.id,
    name: a.name,
    shape: a.shape,
    category: a.category,
    width: a.width,
    depth: a.depth,
    height: a.height,
    color: a.color,
  }));
}