# Interior Studio

Browser-based interior design: draw a floor plan in 2D, see it in 3D instantly, furnish it from a catalog or by asking the AI assistant, and share it with a link.

- **2D plan (PixiJS)** — walls, doors, windows, rooms, grid + snapping, measure tool, box-select, undo/redo.
- **3D view (Three.js)** — the same model in real time; move / rotate / scale furniture with on-screen handles; camera and lighting presets; PNG export.
- **Materials** — wood, stone, metal, fabric, glass and paint finishes for walls, floors and furniture.
- **AI assistant** — "add a grey sofa near the window", "make this room modern". Proposals are previewed and applied only when you confirm. Works offline with a built-in rule engine; plugs into Claude when a key is configured.
- **Ready-made home plans** — 1 BHK, 2 BHK (classic and open-plan), 3 BHK, studio and single-room starters, each drawn with walls, doors, windows and a full set of furniture. The gallery measures every plan (footprint, carpet area, room-by-room areas, furniture count) so you can compare before you commit, then open one and edit it like any other project.
- **Guided tour** — a first run offers a walkthrough of every tool, with Back / Next / Skip and a progress
  count. Come back to it any time from **?** → **Take the tour**.
- **Video manual** — a 3m50s recorded walkthrough ([`docs/USER-MANUAL.md`](docs/USER-MANUAL.md)), produced by
  driving the real app, so it can be regenerated whenever the UI changes.
- **Accounts and roles** — sign-in is required to open the studio. An **Architect** (owner) can do everything, a **Collaborator** can edit but not share or delete, and a **Client** gets a read-only link.
- **Client links** — send a watermarked, view-only link with an expiry date and an optional passcode. No editing, no download, no printing, and every open is logged.
- **Projects** — autosave to the browser, sync to the backend when it's running, import/export JSON, open the same project on any device via its link.

## Quick start

Requirements: Node 20+ (Node 24 recommended — `npm test` uses its built-in TypeScript support), Python 3.11+.

```bash
# 1. The studio app (http://localhost:3000)
npm install
npm run dev

# 2. Storage service, in a second terminal (http://localhost:8000, docs at /docs)
npm run setup:api     # one-time: creates backend/.venv and installs requirements
npm run dev:api       # Windows.  macOS/Linux: npm run dev:api:unix

# 3. Marketing site, optional (http://localhost:5173)
npm run dev:site
```

Sign in at `http://localhost:3000/login` with the seeded account:

| | |
|---|---|
| Email | `ganeshmesta1234@gmail.com` |
| Password | `Ganesh@123` |

Both come from `AUTH_EMAIL` / `AUTH_PASSWORD` — **change them, and set `AUTH_SECRET`, before this is reachable by anyone else.**

The app is fully usable without the backend — projects are saved in the browser. With the backend running, every save also syncs to the server and shared links open on other devices. The status pill in the top bar tells you which mode you're in.

### Configuration

| File | Purpose |
|---|---|
| `apps/web/.env.local` | `AUTH_SECRET` (signs sessions and share links — **set this**), `AUTH_EMAIL` / `AUTH_PASSWORD` / `AUTH_NAME` (the account), `API_ORIGIN` (where the storage service lives, server-side only), `API_TOKEN` (shared secret with it). See `apps/web/.env.example`. |
| `backend/.env` | `DATABASE_URL` (SQLite by default; any SQLAlchemy URL), `CORS_ORIGINS`, `API_TOKEN` (must match the app's), `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` for the Claude-backed assistant. See `backend/.env.example`. |
| `apps/site/.env` | `VITE_SITE_URL` (canonical URL used in metadata and the sitemap) and `VITE_APP_URL` (where the free-trial button points, default `http://localhost:3000`). |

To enable the Claude planner: `pip install anthropic` inside the venv (it's in `requirements.txt`), set `ANTHROPIC_API_KEY` in `backend/.env`, restart the API. The assistant's header badge switches from **Rules** to **Claude**. Every proposal is still reviewed and confirmed by the user before it touches the model.

## Roles and client sharing

| Role | Edit | Export / print | Share links | Delete | Protected view |
|---|---|---|---|---|---|
| **Architect** (owner) | ✅ | ✅ | ✅ | ✅ | — |
| **Collaborator** (editor) | ✅ | ✅ | ❌ | ❌ | — |
| **Client** (viewer) | ❌ | ❌ | ❌ | ❌ | ✅ |

Send a design to a client: open the project → **share icon** → name the recipient, pick *View only*, choose an
expiry and (optionally) a passcode → **Create client link**. They open `/view/<token>` in any browser with no
account.

The role lives *inside* the signed token, so editing the link cannot upgrade it, and the model layer refuses
every command for a read-only session — the buttons being gone is presentation, not the control.

### What "protected" means, precisely

A client link removes every path to a file: no export, no PNG snapshot, no JSON download, and printing yields
a notice instead of the drawing. The view is watermarked with the recipient's name and the date, it blanks
whenever the window loses focus (which is what most capture tools do), copy / right-click / drag are blocked,
a PrintScreen overwrites the clipboard, and every attempt is recorded in the activity log.

**It cannot stop a screenshot.** No web page can: the operating system's own capture, a screen recorder or a
phone camera are all outside the browser's reach, and any product claiming otherwise is describing a blurred
overlay. What this buys you is that casual copying is awkward and anything that does escape carries a
watermark naming the link it came from.

## Using the editor

| Task | How |
|---|---|
| New project | Dashboard → **New project** (or any plan card) → compare the plans in the gallery → **Use this plan** |
| Pan the view | Hold `Space` and drag, with any tool, in the plan **and** in 3D · or press `H` for the Hand tool · or middle-drag in the plan · right-drag or Shift+middle-drag in 3D |
| Orbit in 3D | Left-drag, or middle-drag (Blender style). The wheel zooms toward the cursor and eases in; a flick of a pan keeps gliding |
| Move precisely | Select a piece, then `G` grab / `R` rotate / `S` scale · `X` or `Y` locks an axis · type a number for an exact value · `Enter` or click confirms, `Esc` cancels |
| Jump to a viewpoint | Numpad `1` front, `3` right, `7` top, `9` back, `5` perspective, `.` frames the selection — each an eased flight |
| Share with a client | Share icon → recipient, role, expiry, passcode → **Create client link** |
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
| Guided tour | Press `?` → **Take the tour** — 25 stops covering every tool; Skip or Esc leaves at any point |

## Architecture

```
packages/core        Canonical project model + editor engine (pure TS: geometry, snapping,
                     collision, commands with exact inverses, history). No DOM, no Three.
apps/web             Next.js 15 App Router UI. Zustand stores. Two rendering adapters that
                     derive everything from the model:
                       components/editor/PlanEditor2D.ts + lib/pixi   (2D, PixiJS)
                       components/editor/Canvas3D.tsx   + lib/three  (3D, React Three Fiber)
                     Auth lives in middleware.ts + app/api/auth/*; client links in
                     app/api/share/* and app/view/[token]; all storage traffic goes
                     through the authenticated proxy at app/api/backend/[...path].
apps/site            Marketing site: plain React + Vite (no Next.js), React Router, Tailwind.
                     Statically prerendered to HTML per route by scripts/prerender.mjs,
                     which also emits sitemap.xml, robots.txt and the social card.
backend              FastAPI + SQLAlchemy. Projects keyed on the client id; PUT upserts.
                     Requires X-API-Token when API_TOKEN is set. Optional /ai/plan
                     endpoint backed by the Anthropic SDK.
```

Principles the code follows:

- **Single source of truth.** 2D and 3D both derive from `Project`; neither stores model state. Three.js/Pixi objects never enter the store or the database.
- **Catalog ids are derived from the name** (`living-sofa-3-seat`), never from the `shape`, so re-modelling a piece cannot orphan the projects, templates and AI keywords that reference it.
- **Wall- and ceiling-mounted pieces carry `metadata.mounted`.** They hang above the floor, so the collision engine leaves them out of floor clearance, door blocking and overlap checks.
- **Every mutation is a command** with a computed inverse (`applyCommand`), so undo is exact and history is not a stack of snapshots. Drag gestures render a ghost and commit one command on release.
- **In-place 3D updates.** Only geometry changes rebuild meshes; moving, rotating, scaling or recolouring an object updates it in place, so the transform gizmo stays attached during and after a drag.
- **Offline-first persistence.** localStorage is written within 400 ms of a change; the backend within 1.5 s, keyed on the same id, newest-timestamp-wins on conflict.
- **Permission is checked where it is enforced, not where it is displayed.** The middleware decides who gets a
  page, the proxy decides who reads a project, and `run()` in the editor store refuses commands for a
  read-only session. Hidden buttons are a courtesy on top of those three.
- **Share tokens are signed and self-contained** (HMAC-SHA256 over project, role, expiry and passcode hash),
  so a link keeps working with the storage service down and cannot be edited into a better one. The
  trade-off: a link cannot be revoked before it expires, which is why the expiry is chosen up front.
- **AI proposes, people apply.** Both the rule engine and Claude return the same structured command list; the UI previews it and nothing runs until confirmed. Server-side, model output is sanitised against the actual plan (unknown ids / command types are dropped).

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js dev server / production build / serve the build |
| `npm run typecheck` | `tsc --noEmit` across web + core |
| `npm test` | Node's test runner over the real TS sources (`apps/web/tests/`) — model commands & undo, 3D materials/scene sync, templates, import/export |
| `npm run dev:api` | FastAPI with reload (`dev:api:unix` on macOS/Linux) |
| `npm run setup:api` | Create the backend venv and install requirements |
| `npm run dev:site` / `npm run build:site` / `npm run preview:site` | Marketing site: dev server / static build with prerendering / preview the build |
| `npm run build:all` | Build the app and the marketing site |
| `npm run record:manual` | Re-record the user-manual video (needs the app running) → `apps/site/public/user-manual.mp4` |

## Documentation

| Where | What |
|---|---|
| [`docs/USER-MANUAL.md`](docs/USER-MANUAL.md) | Written manual: create, navigate, add objects, move and rotate, paint a wall, draw structure, export, import, share |
| `apps/site/public/user-manual.mp4` | The same walkthrough as a video, 13 chapters. Also served by the marketing site at `/user-manual.mp4` |
| In the app | `?` for shortcuts, **Take the tour** for the guided walkthrough |

The video is recorded by [`tools/record-manual.mjs`](tools/record-manual.mjs), which drives a real browser
through the app over the DevTools Protocol, draws a visible cursor and captions into the page, captures the
screen, and encodes with the bundled ffmpeg. Every click in it is a real click, so the manual cannot quietly
drift from the product — re-run `npm run record:manual` after a UI change.

## Deploying

- **App:** `npm run build` then `npm start`, or deploy `apps/web` to any Next.js host. Set `AUTH_SECRET` to a long
  random string, change `AUTH_EMAIL` / `AUTH_PASSWORD`, and set `API_ORIGIN` + `API_TOKEN` to reach the storage
  service. Serve it over TLS — the session cookie is marked `secure` in production.
- **Storage service:** `uvicorn app.main:app --host 0.0.0.0 --port 8000` from `backend/`. Set `API_TOKEN` to the
  same value as the app, `DATABASE_URL` to Postgres for anything beyond one machine, and keep it on a private
  network: the browser never calls it directly, so it needs no public address.
- **Marketing site:** `VITE_SITE_URL=https://yourdomain VITE_APP_URL=https://app.yourdomain npm run build:site`
  and serve `apps/site/dist` from any static host. Configure the host to serve `404.html` for unknown paths.
- **Known limits:** one account (multi-user is the next step), and share links cannot be revoked before their
  expiry — both noted in the roadmap below.

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

Multi-user accounts with per-user projects and invitations · revocable share links (a token blocklist) ·
client comments pinned to the plan · real-time collaboration · GLB furniture import · photoreal rendering ·
touch/mobile layout · billing for the plans advertised on the marketing site.
