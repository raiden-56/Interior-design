# Interior Studio — user manual

A written companion to **[`user-manual.mp4`](../apps/site/public/user-manual.mp4)** (3m 50s, 13 chapters). The video was recorded by
driving the real application — see [`tools/record-manual.mjs`](../tools/record-manual.mjs) — so re-running
`npm run record:manual` after a change produces a current video rather than a stale one.

The same file is served by the marketing site at `/user-manual.mp4`.

There is also a guided tour inside the app: press <kbd>?</kbd> and choose **Take the tour**. It stops at every
tool in turn, with **Back**, **Next** and a **Skip**/close on every step.

---

## 1. Signing in

Open `http://localhost:3000`. Anything other than the login screen and a client link needs an account, so an
unauthenticated visit lands on `/login`.

Clients never sign in — they open the read-only link you send them.

## 2. Creating a project

**New project** (or any plan card on the dashboard) opens the plan gallery.

- Filter by **1 BHK / 2 BHK / 3 BHK / Studio / Single room / Blank**.
- Each plan shows its footprint, carpet area in m² and sq ft, a room-by-room breakdown, how many pieces of
  furniture come with it, and what the layout is good at.
- **Use this plan** opens exactly the plan you were comparing. Everything in it stays editable.

Starting from nothing: pick **Blank canvas**, then draw walls, or use **Structure → Quick room** for a
ready-made rectangle.

## 3. Finding your way around

| Action | Plan (2D) | 3D |
|---|---|---|
| Pan | Hold <kbd>Space</kbd> and drag · middle-drag · <kbd>H</kbd> for the Hand tool | Hold <kbd>Space</kbd> and drag · right-drag · <kbd>Shift</kbd>+middle-drag |
| Orbit | — | Left-drag, or middle-drag |
| Zoom | Scroll (toward the cursor, eased) | Scroll |
| Fit everything | <kbd>F</kbd> | <kbd>F</kbd> |
| Switch view | <kbd>1</kbd> plan · <kbd>2</kbd> 3D | same |
| Jump to a viewpoint | — | Numpad <kbd>1</kbd> front, <kbd>3</kbd> right, <kbd>7</kbd> top, <kbd>9</kbd> back, <kbd>5</kbd> perspective, <kbd>.</kbd> frame selection |

A flicked pan keeps gliding and settles; zoom eases toward the target rather than jumping a fixed step.

## 4. Adding objects

1. **Furniture** tab in the left panel.
2. Search by name (*washing machine*, *recliner*, *pooja*) or filter by room.
3. Click the piece — it attaches to the cursor.
4. Click on the plan, or in the 3D view, to drop it.

Every piece carries real dimensions, shown under its name in centimetres. Items tagged **wall** (TV, split AC,
ceiling fan, mirror, geyser, chimney hood) hang at the right height automatically and are left out of floor
clearance checks.

## 5. Modifying: move, rotate, scale, delete

| | |
|---|---|
| Move | Drag it, or arrow keys to nudge one grid step (<kbd>Shift</kbd> for ×4) |
| Rotate | <kbd>[</kbd> and <kbd>]</kbd> rotate 15° at a time |
| Duplicate | <kbd>Ctrl</kbd>+<kbd>D</kbd> |
| Delete | <kbd>Delete</kbd> or <kbd>Backspace</kbd> |
| Exact values | Right-hand properties panel: X, Y, rotation, scale, colour, material |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |

### Precise moves in 3D (Blender style)

Select a piece, then:

- <kbd>G</kbd> grab, <kbd>R</kbd> rotate, <kbd>S</kbd> scale — it follows the pointer.
- <kbd>X</kbd> or <kbd>Y</kbd> locks the movement to one floor axis.
- Type a number for an exact value: `G` `X` `1` `Enter` moves it one metre east.
- <kbd>Ctrl</kbd> snaps while dragging.
- Click or <kbd>Enter</kbd> confirms; <kbd>Esc</kbd> or right-click puts it back.

The whole transform lands as a single undo step. If you prefer the mouse, the **Move / Rotate / Scale** buttons
in the top bar give you on-screen handles instead.

## 6. Painting a wall (materials and colour)

1. Click the wall, floor slab or piece of furniture to select it.
2. **Materials** tab → click a finish. Wood, stone, metal, fabric, glass and paint are all there.
3. Or set a custom colour in the properties panel — that clears the material and keeps your colour.

Material and finish travel together, so brass stays reflective and fabric stays matte in the 3D view.

## 7. Drawing structure

| Tool | Key | How |
|---|---|---|
| Wall | <kbd>B</kbd> | Click to start, click each corner, <kbd>Enter</kbd> or double-click to finish, <kbd>Esc</kbd> to cancel |
| Door | <kbd>D</kbd> | Click on a wall |
| Window | <kbd>N</kbd> | Click on a wall |
| Room | <kbd>R</kbd> | Click each corner, right-click or <kbd>Enter</kbd> to close |
| Measure | <kbd>M</kbd> | Click two points |

Ends snap to the grid, to other wall endpoints and to edges. Openings are cut into the wall in both views at
once, and their width, height, sill and position are editable afterwards.

Floors live in the bottom bar: add a storey, switch between them, or hide one so you can see into the floor
below in 3D.

## 8. Saving, exporting and importing

- **Saving is automatic** — to this browser within half a second, to your account a moment later.
  <kbd>Ctrl</kbd>+<kbd>S</kbd> forces it. The label in the top bar tells you which happened.
- **Export → PNG snapshot** captures the current view, plan or 3D.
- **Export → Download project (.json)** writes the whole model to a file.
- **Export → Import project (.json)** reads one back. It always opens as a *new* project, so importing can
  never overwrite what you have.

## 9. Sharing with a client

1. Open the project → **share icon** in the top bar.
2. Name the recipient (this is what the watermark says).
3. Choose **View only** or **Can edit**.
4. Set when access ends — 7, 14, 30 days or never — and a passcode if you want one.
5. **Create client link**, then copy it.

They open it in any browser, with no account. A view-only link has no editing tools, no export, no download and
no printing, is watermarked with their name and the date, and shows a read-only design summary — carpet area,
room-by-room areas and the furniture schedule.

### What "protected" does and does not mean

It removes every in-app route to a file, watermarks the view, hides the design when the window loses focus,
blocks copy, right-click and the usual capture shortcuts, overwrites the clipboard after a PrintScreen, and
logs every attempt.

**It cannot prevent a screenshot.** No web page can — the operating system's capture tools, a screen recorder
and a phone camera are all outside the browser's control. What you get is that copying is inconvenient and any
image that does escape carries a watermark identifying the link it came from.

## 10. Keyboard reference

Press <kbd>?</kbd> in the app for the live list. The essentials:

```
V select      B wall        D door        N window      R room
M measure     H pan         Space pan (hold, any tool)
1 plan        2 3D          F fit         ? shortcuts

G grab        R rotate      S scale       X / Y axis lock
Ctrl+Z undo   Ctrl+Shift+Z redo           Ctrl+D duplicate
Ctrl+S save   Ctrl+K AI     Ctrl+B / Ctrl+] toggle panels
```

## 11. Walking through the design (first person)

Press **Walk** — in the top bar next to Plan / 3D, or in the bottom bar. The 3D camera flies down to eye
level inside the house. Click once to take hold of the mouse (the browser asks for pointer lock), then:

| Key | Does |
|---|---|
| `W A S D` / arrows | Walk. `Shift` runs, `Ctrl` or `Alt` walks slowly |
| Mouse | Look around. Pitch is clamped so the view never flips |
| `E` | Open or close the door you are looking at · sit on a sofa, chair or bench · lie on a bed · stand up · open a cabinet · switch a lamp · use the lift |
| `C` / `X` | Hide the ceiling / make the walls see-through (design view) |
| `N` | Navigate: pick a room or a piece of furniture and a route is drawn on the floor and on the map (stairs included) |
| `J` | Jump to a floor — a shortcut; the stairs are still there to walk |
| `1` `2` `3` | First person · third person (an avatar you follow) · free camera (fly anywhere) |
| `L` · `M` · `H` · `F` | Lighting (day / evening / night) · map size · hide the HUD · fullscreen |
| `Esc` | Pause (the mouse is released). `Esc` again, or **Exit**, flies you back to exactly the 3D view you left |

Stairs are walked, not clicked: approach the bottom step and keep walking; the floor name in the top-left
updates when you arrive. The walkthrough collides with every wall and piece of furniture in the plan, so if a
doorway is blocked by a wardrobe you will find out here first. Falling off an unfinished floor puts you back at
the nearest safe spot with a short notice.

**Setting it up.** With nothing selected, the Properties panel shows **Walkthrough start**: place one or more
start points in the 3D view (pin icon in the top bar, then click on the floor). Select a door to choose how it
behaves — manual, automatic, always open or locked. Select furniture to change what `E` does with it or to let
the player walk through it. Stairs and lifts are in the furniture catalog under **Stairs & Lifts**; a
staircase's **Rise** should equal the floor height so it arrives on the floor above, and its front edge is the
bottom step.

**Comfort.** The gear icon in the walkthrough's toolbar has mouse sensitivity, walking and running speed, eye
height, field of view, camera smoothing, head bob (off / low / medium), reduced motion, invert Y, sprint and
jump switches, automatic doors and high-contrast prompts. Settings are remembered per browser.

**Clients.** A shared view-only link can include the walkthrough (it is on by default; switch it off in the
share dialog). Nothing a client does inside — opening doors, sitting, switching lamps — touches the design, and
capture stays disabled for them.

## 12. Starting from a paper sketch

Draw the plan on paper, photograph it, and trace it:

1. In the plan view open the **Structure** tab and click **Import a sketch or photo…** under *Paper sketch*.
   The image is scaled down and saved inside the project, so it travels with it.
2. Drag the sketch into place with the Select tool (grab it on an empty spot). Use the **Opacity** slider so
   your own lines stay readable; the eye icon hides it, the lock icon pins it.
3. Set the scale: press `M`, measure something on the sketch whose real length you know (a wall, a door),
   type that length under *Set the scale* and click **Apply**. Width, rotation and position can also be typed in.
4. Draw walls (`B`), doors (`D`), windows (`N`) and rooms (`R`) over the lines. **Show in 3D** lays the sketch on
   the floor in the 3D view as well, which helps when placing furniture.

Each floor has its own sketch, so a two-page drawing becomes two floors.

## Re-recording the video

```bash
npm run dev            # or npm start
npm run record:manual  # writes apps/site/public/user-manual.mp4
```

It writes `apps/site/public/user-manual.mp4`, which is also what the marketing site plays. It launches its
own headless Chrome, signs in, performs every step and encodes the result with the bundled ffmpeg. Flags: `--base`, `--out`, `--email`, `--password`.
