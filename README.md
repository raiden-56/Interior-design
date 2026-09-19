# Interior Studio

Browser-based interior design: draw a floor plan in 2D, see it in 3D instantly, furnish it from a catalog or by asking the AI assistant, and share it with a link.

- **2D plan (PixiJS)** — walls, doors, windows, rooms, grid + snapping, measure tool, box-select, undo/redo.
- **3D view (Three.js)** — the same model in real time; move / rotate / scale furniture with on-screen handles; camera and lighting presets; PNG export.
- **Materials** — wood, stone, metal, fabric, glass and paint finishes for walls, floors and furniture.
- **AI assistant** — "add a grey sofa near the window", "make this room modern". Proposals are previewed and applied only when you confirm. Works offline with a built-in rule engine; plugs into Claude when a key is configured.
- **Ready-made home plans** — 1 BHK, 2 BHK (classic and open-plan), 3 BHK, studio and single-room starters, each drawn with walls, doors, windows and a full set of furniture. The gallery measures every plan (footprint, carpet area, room-by-room areas, furniture count) so you can compare before you commit, then open one and edit it like any other project.
- **Projects** — autosave to the browser, sync to the backend when it's running, import/export JSON, open the same project on any device via its link.

## Quick start

Requirements: Node 20+ (Node 24 recommended — `npm test` uses its built-in TypeScript support), Python 3.11+.

```bash
# 1. Frontend (http://localhost:3000)
npm install
npm run dev

# 2. Backend, in a second terminal (http://localhost:8000, docs at /docs)
npm run setup:api     # one-time: creates backend/.venv and installs requirements
npm run dev:api       # Windows.  macOS/Linux: npm run dev:api:unix
```

The app is fully usable without the backend — projects are saved in the browser. With the backend running, every save also syncs to the server and shared links open on other devices. The status pill in the top bar tells you which mode you're in.

### Configuration

| File | Purpose |
|---|---|
| `apps/web/.env.local` | `NEXT_PUBLIC_API_BASE` — where the browser finds the API (default `http://localhost:8000/api/v1`). See `apps/web/.env.example`. |
| `backend/.env` | `DATABASE_URL` (SQLite by default; any SQLAlchemy URL), `CORS_ORIGINS` (comma-separated), `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` for the Claude-backed assistant. See `backend/.env.example`. |

To enable the Claude planner: `pip install anthropic` inside the venv (it's in `requirements.txt`), set `ANTHROPIC_API_KEY` in `backend/.env`, restart the API. The assistant's header badge switches from **Rules** to **Claude**. Every proposal is still reviewed and confirmed by the user before it touches the model.

## Using the editor

| Task | How |
|---|---|
| New project | Dashboard → **New project** (or any plan card) → compare the plans in the gallery → **Use this plan** |
| Pan the view | Hold `Space` and drag, with any tool, in the plan **and** in 3D · or press `H` for the Hand tool · or middle-drag · 3D also pans on right-drag |
| Draw walls | `B`, click to start, click each corner, `Enter` / double-click to finish, `Esc` to cancel |
| Doors / windows | `D` / `N`, then click on a wall. Adjust width, height, position in the right panel |
| Rooms (floor slabs) | `R`, click each corner, right-click / `Enter` to close — or use **Structure → Quick room** |
| Furniture | Left panel → click an item → click where it goes. Drag to move; arrow keys nudge; `[` `]` rotate; `Ctrl+D` duplicate. 70+ pieces including washing machine, dishwasher, chimney hood, wall TV, split AC, ceiling fan, geyser, pooja unit and bunk beds — wall- and ceiling-mounted items are marked `wall` in the catalog |
| Colours & materials | Select anything → right panel. Or **Materials** tab → click a finish to apply it to the selection |
| 3D | `2` (or the Plan/3D toggle). Left-drag orbits, right-drag or Space-drag pans, scroll zooms. Select furniture and use the Move / Rotate / Scale handles |
| Floors | Bottom bar: add, switch, hide/show in 3D |
| AI | `Ctrl+K`, type a request, review the proposed changes, **Apply** |
| Share | Top bar share icon copies `/editor/<id>`; with the backend running it opens anywhere |
| Export / import | Top bar **Export** → PNG snapshot, JSON download, or **Import project** |
| All shortcuts | Press `?` |

## Architecture

```
packages/core        Canonical project model + editor engine (pure TS: geometry, snapping,
                     collision, commands with exact inverses, history). No DOM, no Three.
apps/web             Next.js 15 App Router UI. Zustand stores. Two rendering adapters that
                     derive everything from the model:
                       components/editor/PlanEditor2D.ts + lib/pixi   (2D, PixiJS)
                       components/editor/Canvas3D.tsx   + lib/three  (3D, React Three Fiber)
backend              FastAPI + SQLAlchemy. Projects keyed on the client id; PUT upserts.
                     Optional /ai/plan endpoint backed by the Anthropic SDK.
```

Principles the code follows:

- **Single source of truth.** 2D and 3D both derive from `Project`; neither stores model state. Three.js/Pixi objects never enter the store or the database.
- **Catalog ids are derived from the name** (`living-sofa-3-seat`), never from the `shape`, so re-modelling a piece cannot orphan the projects, templates and AI keywords that reference it.
- **Wall- and ceiling-mounted pieces carry `metadata.mounted`.** They hang above the floor, so the collision engine leaves them out of floor clearance, door blocking and overlap checks.
- **Every mutation is a command** with a computed inverse (`applyCommand`), so undo is exact and history is not a stack of snapshots. Drag gestures render a ghost and commit one command on release.
- **In-place 3D updates.** Only geometry changes rebuild meshes; moving, rotating, scaling or recolouring an object updates it in place, so the transform gizmo stays attached during and after a drag.
- **Offline-first persistence.** localStorage is written within 400 ms of a change; the backend within 1.5 s, keyed on the same id, newest-timestamp-wins on conflict.
- **AI proposes, people apply.** Both the rule engine and Claude return the same structured command list; the UI previews it and nothing runs until confirmed. Server-side, model output is sanitised against the actual plan (unknown ids / command types are dropped).

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js dev server / production build / serve the build |
| `npm run typecheck` | `tsc --noEmit` across web + core |
| `npm test` | Node's test runner over the real TS sources (`apps/web/tests/`) — model commands & undo, 3D materials/scene sync, templates, import/export |
| `npm run dev:api` | FastAPI with reload (`dev:api:unix` on macOS/Linux) |
| `npm run setup:api` | Create the backend venv and install requirements |

## Deploying

- **Frontend:** `npm run build` then `npm start`, or deploy `apps/web` to any Next.js host. Set `NEXT_PUBLIC_API_BASE` to your API's public URL at build time.
- **Backend:** `uvicorn app.main:app --host 0.0.0.0 --port 8000` from `backend/` (behind a reverse proxy with TLS). Set `DATABASE_URL` to Postgres for anything beyond a single machine and `CORS_ORIGINS` to your frontend origin. The schema is created on startup.
- There is no authentication yet: anyone who can reach the API can read and write any project. Put it behind your own auth/reverse proxy or keep it on a private network until user accounts are added.

## API

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/health` | Liveness |
| `GET  /api/v1/projects` | All projects, scene included |
| `GET  /api/v1/projects/{id}` | One project |
| `PUT  /api/v1/projects/{id}` | Upsert (body: `name, units, floorHeight, scene, updatedAt`) — stale writes are ignored |
| `DELETE /api/v1/projects/{id}` | Delete |
| `GET  /api/v1/ai/status` | Whether the Claude planner is configured |
| `POST /api/v1/ai/plan` | `{prompt, project, activeFloorId}` → `{actions, engine}`; 503 when not configured |

Interactive docs at `http://localhost:8000/docs`.

## Roadmap / not yet built

User accounts and per-user projects · real-time collaboration · GLB furniture import · photoreal rendering · touch/mobile layout.
