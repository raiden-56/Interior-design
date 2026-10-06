# Building plans with an AI

Two ways to have a model draw the home for you. Both produce an ordinary project: every wall, door, window
and piece of furniture is editable afterwards, and the walkthrough works on it immediately.

## 1. Your own API key (Claude or OpenAI)

Dashboard → **Build a plan with your AI → Use your API key**.

1. Pick **Claude (Anthropic)** or **OpenAI** and paste a key (`sk-ant-…` / `sk-…`). The model field offers
   sensible defaults (`claude-opus-5-5`, `gpt-5`) and accepts any model id you have access to.
2. Describe the home — size, rooms, what goes where, one or two floors. The three example chips show the level
   of detail that works well.
3. **Generate the plan.** A full plan takes one to two minutes. The preview shows the footprint, rooms with
   areas and the furniture count, plus validation notes for anything the model got wrong that was dropped.
4. **Open in the editor.** The project is saved like any other.

What happens to the key: it is sent with that one request to this app's own server
(`/api/ai/generate-plan`), which calls the provider and discards it. Tick **Remember the key in this browser**
to keep it in `localStorage` for next time; it never goes anywhere else. Usage is billed to your provider
account.

How the answer is validated: both providers are asked for a `PlanSpec` under a JSON schema
(`apps/web/src/lib/ai-plan.ts`). The server converts it into the canonical project with the same code the
MCP tools use — unknown furniture ids, doors on missing walls, zero-length walls and off-wall windows are
dropped and reported — and then runs the editor's collision analysis. Nothing a model writes reaches the
model layer unchecked.

Claude requests use adaptive thinking at high effort, structured output, streaming, and Anthropic's
server-side fallback so a declined request is retried on another model within the same call.

## 2. Connect Claude Desktop, Cursor, Codex or Claude Code (MCP)

The studio ships a Model Context Protocol server (`tools/mcp-server.mjs`) with tools that build and edit
projects directly. Your AI app does the designing with its own model and account.

Dashboard → **Build a plan with your AI → Connect Claude · Cursor · Codex (MCP)** shows a ready-to-paste
configuration for each client with the absolute paths of this checkout. In short:

```jsonc
// Claude Desktop (%APPDATA%\Claude\claude_desktop_config.json) or Cursor (.cursor/mcp.json)
{
  "mcpServers": {
    "interior-studio": {
      "command": "node",
      "args": [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import", "<repo>/apps/web/scripts/register-test-loader.mjs",
        "<repo>/tools/mcp-server.mjs"
      ],
      "env": { "INTERIOR_API": "http://localhost:8000/api/v1", "INTERIOR_STUDIO_URL": "http://localhost:3000" }
    }
  }
}
```

```toml
# Codex (~/.codex/config.toml)
[mcp_servers.interior-studio]
command = "node"
args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "<repo>/apps/web/scripts/register-test-loader.mjs", "<repo>/tools/mcp-server.mjs"]
[mcp_servers.interior-studio.env]
INTERIOR_API = "http://localhost:8000/api/v1"
INTERIOR_STUDIO_URL = "http://localhost:3000"
```

```bash
# Claude Code
claude mcp add interior-studio -e INTERIOR_API=http://localhost:8000/api/v1 -e INTERIOR_STUDIO_URL=http://localhost:3000 -- node --import <repo>/apps/web/scripts/register-test-loader.mjs <repo>/tools/mcp-server.mjs
```

Requirements: Node 22.12 or newer (the server loads the repository's TypeScript directly), and the storage
service running (`npm run dev:api`) so the project the AI builds is saved where the studio opens it by link.
Without the service the server keeps projects in `~/.interior-studio/mcp-projects/` and the
`export_project_json` tool returns a file to import from the dashboard. Set `INTERIOR_API_TOKEN` if the
service has an `API_TOKEN`.

Then ask the assistant, for example: *"In Interior Studio, design a 2 BHK with an open kitchen, furnish it,
set the walkthrough start at the front door and give me the link."*

### Tools

| Tool | What it does |
|---|---|
| `authoring_guide` | Coordinate system, PlanSpec shape and design rules — the assistant reads this first |
| `list_catalog`, `list_templates`, `list_projects` | What can be placed, started from, and already exists |
| `create_project` | Empty project or one from a template |
| `create_project_from_spec` | A whole plan in one call (floors, walls, rooms, doors, windows, furniture, start) |
| `get_project` | Everything with ids, for follow-up edits |
| `add_floor`, `add_walls`, `add_rectangular_room`, `add_room` | Structure |
| `add_door`, `add_window` | Openings by wall id or nearest point |
| `place_furniture`, `update_object`, `remove_items` | Furniture |
| `set_walkthrough_start` | Where **Walk** begins |
| `validate_project` | The editor's collision analysis |
| `export_project_json`, `open_in_studio` | Hand the result back |

Every mutation goes through the same command engine as the editor (`applyCommand`), so an AI-built project is
indistinguishable from a hand-drawn one. The stdio transport is a hand-rolled JSON-RPC loop with no
dependencies; `npm run mcp` starts it for a manual test.

## Drawing exports (PDF and DXF)

Editor → **Export** → **PDF drawing set** or **2D CAD drawing (.dxf)**. Both offer **with** or **without
watermark** (the text is editable and defaults to your name, the project and the date), all floors or the
active floor, and furniture on or off. The PDF adds paper size, a title block with scale, an area schedule, a
north arrow, overall dimensions, door swings, and an optional page with the current 3D view. The DXF is
AutoCAD R12 in metres with one layer per element type (WALLS, DOORS, WINDOWS, ROOMS, FURNITURE, TEXT,
DIMENSIONS, TITLE, WATERMARK), so the receiving CAD user can switch layers off. Both are generated in the
browser from the model; nothing is uploaded, and clients on a view-only link have no export at all.
