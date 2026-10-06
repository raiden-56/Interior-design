#!/usr/bin/env node
/**
 * Interior Studio as an MCP server (stdio).
 *
 * Lets Claude Desktop, Cursor, Codex or any Model Context Protocol client
 * build and edit floor plans in the studio: create a project, draw walls and
 * rooms, hang doors and windows, place furniture from the catalog, validate,
 * then hand back a link that opens it in the editor (and the walkthrough).
 *
 * Projects are saved to the storage service (backend/, `npm run dev:api`) so
 * the studio opens them by link; without it, the client gets the project JSON
 * to import from the dashboard.
 *
 * Run (Node 22.12+, the repo's TypeScript is loaded directly):
 *   node --import ./apps/web/scripts/register-test-loader.mjs tools/mcp-server.mjs
 *
 * Environment:
 *   INTERIOR_API          storage service base, default http://localhost:8000/api/v1
 *   INTERIOR_API_TOKEN    its API_TOKEN, if set
 *   INTERIOR_STUDIO_URL   where the web app runs, default http://localhost:3000
 *
 * Only JSON-RPC goes to stdout; everything else goes to stderr.
 */
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { TOOL_DEFINITIONS, callTool } = await import('../apps/web/src/lib/mcp-tools.ts');
const { projectToScene } = await import('../apps/web/src/lib/storage.ts');

const API = (process.env.INTERIOR_API ?? 'http://localhost:8000/api/v1').replace(/\/$/, '');
const TOKEN = process.env.INTERIOR_API_TOKEN ?? '';
const STUDIO = (process.env.INTERIOR_STUDIO_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const CACHE_DIR = path.join(os.homedir(), '.interior-studio', 'mcp-projects');

const log = (...args) => console.error('[interior-mcp]', ...args);

// --- project store: storage service first, local JSON files as the fallback -----

const memory = new Map();

async function api(method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-api-token': TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function fromRemote(r) {
  const floors = r.scene?.floors;
  if (!Array.isArray(floors) || !floors.length) return null;
  return {
    id: r.id,
    name: r.name,
    units: r.scene?.units ?? r.units ?? 'meters',
    floorHeight: r.scene?.floorHeight ?? r.floorHeight ?? 3,
    floors,
    updatedAt: r.updatedAt || 0,
    ...(r.scene?.walkthrough ? { walkthrough: r.scene.walkthrough } : {}),
  };
}

function cacheFile(id) {
  return path.join(CACHE_DIR, `${id.replace(/[^a-z0-9_-]/gi, '_')}.json`);
}

const store = {
  async get(id) {
    if (memory.has(id)) return memory.get(id);
    try {
      const p = fromRemote(await api('GET', `/projects/${encodeURIComponent(id)}`));
      if (p) {
        memory.set(id, p);
        return p;
      }
    } catch {
      /* fall through to the local cache */
    }
    try {
      const p = JSON.parse(fs.readFileSync(cacheFile(id), 'utf8'));
      memory.set(id, p);
      return p;
    } catch {
      return null;
    }
  },
  async put(project) {
    project.updatedAt = Date.now();
    memory.set(project.id, project);
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile(project.id), JSON.stringify(project));
    } catch (e) {
      log('could not write local cache:', e.message);
    }
    try {
      await api('PUT', `/projects/${encodeURIComponent(project.id)}`, {
        name: project.name,
        units: project.units,
        floorHeight: project.floorHeight,
        scene: projectToScene(project),
        updatedAt: project.updatedAt,
      });
      return { synced: true };
    } catch (e) {
      return { synced: false, note: `storage service not reachable at ${API} (${e.message}); the project is kept locally — use export_project_json and import it in the studio, or start the service with "npm run dev:api".` };
    }
  },
  async list() {
    const out = new Map();
    try {
      for (const r of await api('GET', '/projects')) out.set(r.id, { id: r.id, name: r.name, updatedAt: r.updatedAt || 0 });
    } catch {
      /* offline */
    }
    for (const p of memory.values()) out.set(p.id, { id: p.id, name: p.name, updatedAt: p.updatedAt });
    return Array.from(out.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  studioUrl(id) {
    return `${STUDIO}/editor/${id}`;
  },
};

// --- JSON-RPC over stdio -----------------------------------------------------------

const SERVER_INFO = { name: 'interior-studio', version: '1.0.0' };
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  write({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      reply(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Interior Studio: build floor plans the studio can open and walk through. Start with authoring_guide and list_catalog, then create_project_from_spec (whole plan at once) or create_project + add_* tools (step by step). Finish with validate_project and open_in_studio.',
      });
      return;
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return;
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOL_DEFINITIONS });
      return;
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const result = await callTool(name, args, store);
      reply(id, { content: [{ type: 'text', text: result.text }], isError: !!result.isError });
      return;
    }
    case 'resources/list':
      reply(id, { resources: [] });
      return;
    case 'prompts/list':
      reply(id, { prompts: [] });
      return;
    default:
      if (isRequest) fail(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    fail(null, -32700, 'Parse error');
    return;
  }
  const batch = Array.isArray(msg) ? msg : [msg];
  for (const m of batch) {
    handle(m).catch((e) => {
      log('handler error', e);
      if (m.id !== undefined) fail(m.id, -32603, e instanceof Error ? e.message : String(e));
    });
  }
});
rl.on('close', () => process.exit(0));
log(`ready — storage ${API}, studio ${STUDIO}`);
