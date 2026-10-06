'use client';

import * as React from 'react';
import { X, Trash2, Layers, Copy, Footprints, MapPin } from 'lucide-react';
import type { Command, Door, DoorBehavior, ProjectObject, Room, UnitSystem, Wall, Window } from '@interior/core';
import { wallLength, fromMeters, toMeters, formatLength, formatArea, polygonArea, doorBehavior } from '@interior/core';
import { collisionEnabled, hasExplicitCollision, hasExplicitInteraction, interactionOf, defaultInteraction, INTERACTION_TYPES, type InteractionType } from '@/components/walkthrough/FurnitureInteraction';
import { useEditorStore, type SelectionInfo } from '@/stores/editor-store';
import { useUiStore } from '@/stores/ui-store';
import { MATERIALS, MATERIAL_CATEGORIES, SWATCHES, materialById } from '@/lib/materials';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Section, Row, Slider, ColorField, SwatchRow } from '@/components/ui/panel';

export function RightPanel() {
  const toggleRight = useUiStore((s) => s.toggleRight);
  const selection = useEditorStore((s) => s.selection);
  // Subscribe to the model as well. Memoising on `selection` alone (and
  // subscribing to nothing else) left every field in this panel frozen at the
  // values the item had when it was first selected — so picking a colour or
  // dragging a slider looked like it did nothing, and the inputs snapped back.
  const project = useEditorStore((s) => s.project);
  const activeFloorId = useEditorStore((s) => s.activeFloorId);
  const infos: SelectionInfo[] = React.useMemo(
    () => useEditorStore.getState().selectionInfo(),
    [selection, project, activeFloorId],
  );

  return (
    <aside data-tour="right-panel" className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-[#0d1016]">
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Properties</span>
        <button onClick={toggleRight} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Hide panel (Ctrl+])">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {infos.length === 0 && (
          <>
            <div className="space-y-3 py-2 text-center text-xs text-zinc-500">
              <Layers className="mx-auto h-8 w-8 text-zinc-700" />
              <p>
                Select a wall, door, window, room or piece of furniture to edit its properties.
                <br />
                <span className="text-zinc-600">(click an item on the plan or in 3D)</span>
              </p>
            </div>
            <WalkthroughStartSection />
          </>
        )}
        {infos.length === 1 && <SingleInfo info={infos[0]} />}
        {infos.length > 1 && <MultiInfo infos={infos} />}
      </div>
    </aside>
  );
}

function SingleInfo({ info }: { info: SelectionInfo }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium capitalize text-zinc-100">{info.kind}</h3>
          <p className="text-[10px] text-zinc-500">{info.id}</p>
        </div>
        <div className="flex items-center gap-1">
          {info.kind === 'object' && <DuplicateButton />}
          <DeleteButton kind={info.kind} id={info.id} />
        </div>
      </div>
      {info.kind === 'wall' && <WallEditor info={info} />}
      {info.kind === 'door' && <DoorEditor info={info} />}
      {info.kind === 'window' && <WindowEditor info={info} />}
      {info.kind === 'room' && <RoomEditor info={info} />}
      {info.kind === 'object' && <ObjectEditor info={info} />}
    </div>
  );
}

function MultiInfo({ infos }: { infos: SelectionInfo[] }) {
  const run = useEditorStore((s) => s.run);
  const deleteSelection = useEditorStore((s) => s.deleteSelection);
  const objects = infos.filter((i) => i.kind === 'object');
  const paintable = infos.filter((i) => i.kind === 'object' || i.kind === 'wall' || i.kind === 'room');

  const applyMaterial = (value: string) => {
    const patch = materialPatch(value);
    const commands: Command[] = paintable.map((i) =>
      i.kind === 'object'
        ? { type: 'UPDATE_OBJECT', id: i.id, patch }
        : i.kind === 'wall'
          ? { type: 'UPDATE_WALL', id: i.id, patch }
          : { type: 'UPDATE_ROOM', id: i.id, patch },
    );
    if (commands.length) run({ type: 'BATCH', label: 'Apply material to selection', commands });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{infos.length} items</h3>
          <p className="text-[10px] text-zinc-500">
            {objects.length} furniture · {infos.filter((i) => i.kind === 'wall').length} walls · {infos.filter((i) => i.kind === 'room').length} rooms
          </p>
        </div>
        <Button variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:bg-red-500/10" onClick={deleteSelection} title="Delete selection (Del)">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {paintable.length > 0 && (
        <Section title="Appearance (all)">
          <Row label="Material">
            <MaterialSelect value={null} onChange={applyMaterial} />
          </Row>
          <div className="pt-1">
            <SwatchRow swatches={SWATCHES} value={null} onChange={(hex) => {
              const commands: Command[] = paintable.map((i) =>
                i.kind === 'object'
                  ? { type: 'UPDATE_OBJECT', id: i.id, patch: { color: hex, materialId: null } }
                  : i.kind === 'wall'
                    ? { type: 'UPDATE_WALL', id: i.id, patch: { color: hex, materialId: null } }
                    : { type: 'UPDATE_ROOM', id: i.id, patch: { color: hex, materialId: null } },
              );
              run({ type: 'BATCH', label: 'Recolour selection', commands });
            }} />
          </div>
        </Section>
      )}
      <p className="text-[10px] leading-relaxed text-zinc-500">
        Arrow keys move selected furniture · <kbd className="rounded bg-zinc-800 px-1">[</kbd> / <kbd className="rounded bg-zinc-800 px-1">]</kbd> rotate · Ctrl+D duplicates.
      </p>
    </div>
  );
}

// ---- unit-aware controls ---------------------------------------------------

/**
 * All model lengths are metres. The panel displays and edits them in the
 * project's unit so a "Thickness (cm)" slider shows 15, not 0.15.
 */
function useUnits() {
  const units = useEditorStore((s) => s.project.units);
  return React.useMemo(() => {
    const label = units === 'feet' ? 'ft' : units === 'centimeters' ? 'cm' : 'm';
    const step = units === 'feet' ? 0.05 : units === 'centimeters' ? 1 : 0.01;
    const digits = units === 'centimeters' ? 0 : 2;
    return {
      units,
      label,
      step,
      digits,
      show: (m: number) => fromMeters(m, units),
      parse: (v: number) => toMeters(v, units),
    };
  }, [units]);
}

type UnitInfo = ReturnType<typeof useUnits>;

function LengthSlider({
  value,
  min,
  max,
  onChange,
  u,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (meters: number) => void;
  u: UnitInfo;
}) {
  return (
    <Slider
      min={round(u.show(min), 3)}
      max={round(u.show(max), 3)}
      step={u.step}
      digits={u.digits}
      value={u.show(value)}
      onChange={(v) => onChange(u.parse(v))}
    />
  );
}

function LengthInput({ value, onChange, u }: { value: number; onChange: (meters: number) => void; u: UnitInfo }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? String(round(u.show(value), u.digits));
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onChange(u.parse(n));
    setDraft(null);
  };
  return (
    <Input
      value={shown}
      type="number"
      step={u.step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

// ---- editors -----------------------------------------------------------------

function WallEditor({ info }: { info: SelectionInfo }) {
  const run = useEditorStore((s) => s.run);
  const u = useUnits();
  const wall = info.item as Wall;

  return (
    <>
      <Section title="Geometry">
        <Row label="Length">
          <span className="w-full text-right text-xs text-zinc-300">{formatLength(wallLength(wall), u.units)}</span>
        </Row>
        <Row label={`Thickness (${u.label})`}>
          <LengthSlider min={0.04} max={0.6} value={wall.thickness} u={u} onChange={(v) => run({ type: 'UPDATE_WALL', id: wall.id, patch: { thickness: round(v, 3) } })} />
        </Row>
        <Row label={`Height (${u.label})`}>
          <LengthSlider min={1.2} max={6} value={wall.height} u={u} onChange={(v) => run({ type: 'UPDATE_WALL', id: wall.id, patch: { height: round(v, 3) } })} />
        </Row>
      </Section>
      <Section title="Appearance">
        <Row label="Color">
          {/* Choosing a colour clears the material, otherwise the material
              would keep winning and this control would appear dead. */}
          <ColorField
            value={materialById(wall.materialId)?.color ?? wall.color}
            onChange={(c) => run({ type: 'UPDATE_WALL', id: wall.id, patch: { color: c, materialId: null } })}
          />
        </Row>
        <Row label="Material">
          <MaterialSelect value={wall.materialId} onChange={(v) => run({ type: 'UPDATE_WALL', id: wall.id, patch: materialPatch(v) })} />
        </Row>
        <div className="pt-1">
          <SwatchRow swatches={SWATCHES} value={wall.color} onChange={(hex) => run({ type: 'UPDATE_WALL', id: wall.id, patch: { color: hex, materialId: null } })} />
        </div>
      </Section>
    </>
  );
}

function DoorEditor({ info }: { info: SelectionInfo }) {
  const run = useEditorStore((s) => s.run);
  const u = useUnits();
  const door = info.item as Door;
  const wall = useEditorStore((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.walls.find((w) => w.id === door.wallId));
  const maxOffset = wall ? Math.max(wallLength(wall) - door.width, 0) : 3;

  return (
    <>
      <Section title="Geometry">
      <Row label={`Width (${u.label})`}>
        <LengthSlider min={0.6} max={1.8} value={door.width} u={u} onChange={(v) => run({ type: 'UPDATE_DOOR', id: door.id, patch: { width: round(v, 3) } })} />
      </Row>
      <Row label={`Height (${u.label})`}>
        <LengthSlider min={1.8} max={3} value={door.height} u={u} onChange={(v) => run({ type: 'UPDATE_DOOR', id: door.id, patch: { height: round(v, 3) } })} />
      </Row>
      <Row label={`Position (${u.label})`}>
        <LengthSlider min={0} max={Math.max(maxOffset, 0.01)} value={door.offset} u={u} onChange={(v) => run({ type: 'UPDATE_DOOR', id: door.id, patch: { offset: round(v, 3) } })} />
      </Row>
      <Row label="Swing">
        <div className="flex w-full items-center gap-1">
          {([0, 1, 2] as const).map((s) => (
            <button
              key={s}
              onClick={() => run({ type: 'UPDATE_DOOR', id: door.id, patch: { swing: s } })}
              className={
                'flex-1 rounded border px-2 py-1 text-[10px] ' +
                (door.swing === s ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-500')
              }
            >
              {s === 0 ? 'None' : s === 1 ? 'In' : 'Out'}
            </button>
          ))}
        </div>
      </Row>
      </Section>
      <Section title="Walkthrough">
        <Row label="Behaviour">
          <div className="grid w-full grid-cols-2 gap-1">
            {(
              [
                ['manual', 'Manual (E)'],
                ['automatic', 'Automatic'],
                ['open', 'Always open'],
                ['locked', 'Locked'],
              ] as [DoorBehavior, string][]
            ).map(([b, label]) => (
              <button
                key={b}
                onClick={() => run({ type: 'UPDATE_DOOR', id: door.id, patch: { metadata: { ...(door.metadata ?? {}), doorBehavior: b } } }, 'Door behaviour')}
                className={
                  'rounded border px-2 py-1 text-[10px] ' +
                  (doorBehavior(door) === b ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300')
                }
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          How the door behaves when someone walks up to it. Manual doors open with <kbd className="rounded bg-zinc-800 px-1">E</kbd>; automatic ones open as you approach.
        </p>
      </Section>
    </>
  );
}

function WindowEditor({ info }: { info: SelectionInfo }) {
  const run = useEditorStore((s) => s.run);
  const u = useUnits();
  const win = info.item as Window;
  const wall = useEditorStore((s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.walls.find((w) => w.id === win.wallId));
  const maxOffset = wall ? Math.max(wallLength(wall) - win.width, 0) : 3;

  return (
    <Section title="Geometry">
      <Row label={`Width (${u.label})`}>
        <LengthSlider min={0.4} max={3} value={win.width} u={u} onChange={(v) => run({ type: 'UPDATE_WINDOW', id: win.id, patch: { width: round(v, 3) } })} />
      </Row>
      <Row label={`Height (${u.label})`}>
        <LengthSlider min={0.4} max={3} value={win.height} u={u} onChange={(v) => run({ type: 'UPDATE_WINDOW', id: win.id, patch: { height: round(v, 3) } })} />
      </Row>
      <Row label={`Sill (${u.label})`}>
        <LengthSlider min={0.1} max={1.6} value={win.sill} u={u} onChange={(v) => run({ type: 'UPDATE_WINDOW', id: win.id, patch: { sill: round(v, 3) } })} />
      </Row>
      <Row label={`Position (${u.label})`}>
        <LengthSlider min={0} max={Math.max(maxOffset, 0.01)} value={win.offset} u={u} onChange={(v) => run({ type: 'UPDATE_WINDOW', id: win.id, patch: { offset: round(v, 3) } })} />
      </Row>
    </Section>
  );
}

function RoomEditor({ info }: { info: SelectionInfo }) {
  const run = useEditorStore((s) => s.run);
  const u = useUnits();
  const room = info.item as Room;
  const area = Math.abs(polygonArea(room.points));
  return (
    <>
      <Section title="Room">
        <Row label="Name">
          <Input value={room.name} onChange={(e) => run({ type: 'UPDATE_ROOM', id: room.id, patch: { name: e.target.value } })} />
        </Row>
        <Row label="Area">
          <span className="w-full text-right text-xs text-zinc-300">{formatArea(area, u.units)}</span>
        </Row>
        <Row label="Corners">
          <span className="w-full text-right text-xs text-zinc-300">{room.points.length}</span>
        </Row>
      </Section>
      <Section title="Floor finish">
        <Row label="Color">
          <ColorField
            value={materialById(room.materialId)?.color ?? room.color}
            onChange={(c) => run({ type: 'UPDATE_ROOM', id: room.id, patch: { color: c, materialId: null } })}
          />
        </Row>
        <Row label="Material">
          <MaterialSelect value={room.materialId} onChange={(v) => run({ type: 'UPDATE_ROOM', id: room.id, patch: materialPatch(v) })} />
        </Row>
      </Section>
    </>
  );
}

function ObjectEditor({ info }: { info: SelectionInfo }) {
  const run = useEditorStore((s) => s.run);
  const u = useUnits();
  const obj = info.item as ProjectObject;
  const material = materialById(obj.materialId);
  const rotationDeg = Math.round((obj.rotation * 180) / Math.PI);

  return (
    <>
      <Section title="Object">
        <Row label="Name">
          <Input value={obj.name} onChange={(e) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { name: e.target.value } })} />
        </Row>
        <Row label={`X (${u.label})`}>
          <LengthInput value={obj.x} u={u} onChange={(m) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { x: round(m, 3) } })} />
        </Row>
        <Row label={`Y (${u.label})`}>
          <LengthInput value={obj.z} u={u} onChange={(m) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { z: round(m, 3) } })} />
        </Row>
        <Row label={`Rotation (${rotationDeg}°)`}>
          <Slider min={-180} max={180} step={5} digits={0} value={rotationDeg} onChange={(v) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { rotation: (v * Math.PI) / 180 } })} />
        </Row>
        <Row label="Scale">
          <Slider min={0.5} max={2} step={0.05} value={obj.scale} onChange={(v) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { scale: v } })} />
        </Row>
        <Row label="Footprint">
          <span className="w-full text-right text-xs text-zinc-300">
            {formatLength(obj.width * obj.scale, u.units, 2)} × {formatLength(obj.depth * obj.scale, u.units, 2)} · {formatLength(obj.height * obj.scale, u.units, 2)} high
          </span>
        </Row>
      </Section>
      <Section title="Appearance">
        <Row label="Color">
          <ColorField
            value={material?.color ?? obj.color ?? '#c0c0c0'}
            onChange={(c) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { color: c, materialId: null } })}
          />
        </Row>
        <Row label="Material">
          <MaterialSelect value={obj.materialId} onChange={(v) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: materialPatch(v) })} />
        </Row>
        {material && (
          <Row label="Finish">
            <span className="w-full text-right text-xs capitalize text-zinc-400">
              {material.category} · roughness {material.roughness} · metal {material.metalness}
            </span>
          </Row>
        )}
        <div className="pt-1">
          <SwatchRow swatches={SWATCHES} value={obj.color} onChange={(hex) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { color: hex, materialId: null } })} />
        </div>
      </Section>
      <ObjectWalkthroughSection obj={obj} />
    </>
  );
}

/**
 * How a piece behaves when someone walks up to it. Defaults come from the
 * catalog shape; anything set here is stored in `metadata`, the same bag that
 * already carries `mounted`, so the model stays the single source of truth.
 */
function ObjectWalkthroughSection({ obj }: { obj: ProjectObject }) {
  const run = useEditorStore((s) => s.run);
  const u = useUnits();
  const current = interactionOf(obj).type;
  const explicit = hasExplicitInteraction(obj);
  const setMeta = (patch: Record<string, unknown>, label: string) => {
    const next: Record<string, unknown> = { ...(obj.metadata ?? {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { metadata: next } }, label);
  };
  const labelOf = (t: InteractionType) =>
    ({ sit: 'Sit', lie: 'Lie down', cabinet: 'Open / close', drawer: 'Open / close (appliance)', light: 'Light switch', switch: 'On / off', view: 'Look at', inspect: 'Inspect', elevator: 'Elevator', stairs: 'Stairs', none: 'Nothing', door: 'Door', window: 'Window', object: 'Inspect' })[t];

  return (
    <Section title="Walkthrough">
      {obj.shape === 'stairs' && (
        <>
          <Row label={`Rise (${u.label})`}>
            <LengthInput value={obj.height} u={u} onChange={(m) => run({ type: 'UPDATE_OBJECT', id: obj.id, patch: { height: round(m, 3) } })} />
          </Row>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Total height the flight climbs — match the floor height so it arrives on the next floor. The front edge is the bottom step; rotate the piece to face the stairs the right way.
          </p>
        </>
      )}
      <Row label="Interaction">
        <select
          value={explicit ? current : 'auto'}
          onChange={(e) => {
            const v = e.target.value;
            setMeta({ interaction: v === 'auto' ? undefined : { ...((obj.metadata?.interaction as object) ?? {}), type: v } }, 'Walkthrough interaction');
          }}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-sky-500/50"
        >
          <option value="auto">Auto · {labelOf(defaultInteraction(obj.shape))}</option>
          {INTERACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {labelOf(t)}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Solid">
        <label className="flex w-full cursor-pointer items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={collisionEnabled(obj)}
            onChange={(e) => setMeta({ collisionEnabled: e.target.checked }, 'Walkthrough collision')}
            className="accent-sky-500"
          />
          <span>
            Blocks the player
            {!hasExplicitCollision(obj) && <span className="ml-1 text-[10px] text-zinc-500">(default)</span>}
          </span>
        </label>
      </Row>
    </Section>
  );
}

/** Where the walkthrough begins. Spawn points live on the project, never in runtime state. */
function WalkthroughStartSection() {
  const run = useEditorStore((s) => s.run);
  const project = useEditorStore((s) => s.project);
  const setView = useEditorStore((s) => s.setView);
  const pushToast = useEditorStore((s) => s.pushToast);
  const pendingSpawn = useUiStore((s) => s.pendingSpawn);
  const setPendingSpawn = useUiStore((s) => s.setPendingSpawn);
  const wt = project.walkthrough ?? { spawns: [], startSpawnId: null };
  const floorName = (id: string) => project.floors.find((f) => f.id === id)?.name ?? '—';
  const save = (spawns: typeof wt.spawns, startSpawnId: string | null, label: string) =>
    run({ type: 'UPDATE_PROJECT', patch: { walkthrough: { spawns, startSpawnId } } }, label);

  return (
    <Section title="Walkthrough start">
      <p className="text-[10px] leading-relaxed text-zinc-500">
        Where <b className="text-zinc-300">Walk</b> drops you in. Without one, the walkthrough starts in the middle of the largest room.
      </p>
      <button
        onClick={() => {
          setView('3d');
          setPendingSpawn(true);
          pushToast('Click on the floor in 3D to place the start point', 'info');
        }}
        className={
          'flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] ' +
          (pendingSpawn ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 bg-zinc-900/60 text-zinc-200 hover:border-emerald-500/40')
        }
      >
        <MapPin className="h-3.5 w-3.5" /> {pendingSpawn ? 'Click on the floor in 3D…' : 'Place start point in 3D'}
      </button>
      {wt.spawns.length > 0 && (
        <ul className="space-y-1">
          {wt.spawns.map((s) => {
            const active = s.id === (wt.startSpawnId ?? wt.spawns[0].id);
            return (
              <li key={s.id} className={'flex items-center gap-2 rounded-md border px-2 py-1.5 ' + (active ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800')}>
                <Footprints className={'h-3.5 w-3.5 shrink-0 ' + (active ? 'text-emerald-400' : 'text-zinc-500')} />
                <input
                  value={s.name}
                  onChange={(e) => save(wt.spawns.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)), wt.startSpawnId, 'Rename start point')}
                  className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none"
                />
                <span className="shrink-0 text-[10px] text-zinc-500">{floorName(s.floorId)}</span>
                {!active && (
                  <button onClick={() => save(wt.spawns, s.id, 'Choose start point')} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/10">
                    Use
                  </button>
                )}
                <button
                  onClick={() => save(wt.spawns.filter((x) => x.id !== s.id), wt.startSpawnId === s.id ? null : wt.startSpawnId, 'Remove start point')}
                  className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function DuplicateButton() {
  const duplicateSelection = useEditorStore((s) => s.duplicateSelection);
  return (
    <Button variant="ghost" className="h-7 w-7 p-0 text-zinc-300" onClick={duplicateSelection} title="Duplicate (Ctrl+D)">
      <Copy className="h-4 w-4" />
    </Button>
  );
}

function DeleteButton({ kind, id }: { kind: SelectionInfo['kind']; id: string }) {
  const run = useEditorStore((s) => s.run);
  return (
    <Button variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:bg-red-500/10" onClick={() => run(deleteCommand(kind, id))} title="Delete (Del)">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function deleteCommand(kind: SelectionInfo['kind'], id: string): Command {
  switch (kind) {
    case 'wall':
      return { type: 'DELETE_WALL', id };
    case 'door':
      return { type: 'DELETE_DOOR', id };
    case 'window':
      return { type: 'DELETE_WINDOW', id };
    case 'room':
      return { type: 'DELETE_ROOM', id };
    case 'object':
      return { type: 'DELETE_OBJECT', id };
  }
}

/** Material picker shared by the wall, room and object editors. */
function MaterialSelect({ value, onChange }: { value: string | null; onChange: (value: string) => void }) {
  return (
    <select
      value={value ?? 'none'}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-sky-500/50"
    >
      <option value="none">Custom color</option>
      {MATERIAL_CATEGORIES.map((c) => (
        <optgroup key={c.id} label={c.label}>
          {MATERIALS.filter((m) => m.category === c.id).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Patch for choosing a library material. The raw `color` is written to match
 * so the swatch in this panel agrees with what the 3D view renders.
 */
function materialPatch(value: string): { materialId: string | null; color?: string } {
  if (value === 'none') return { materialId: null };
  const m = materialById(value);
  return m ? { materialId: value, color: m.color } : { materialId: value };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export type { UnitSystem };
