import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Ready-to-paste MCP client configuration for this checkout.
 *
 * The server knows where the repository lives; the browser does not, and the
 * one thing people get wrong when wiring an MCP server is the path. So this
 * returns the exact command and arguments for Claude Desktop, Cursor and
 * Codex, pointing at the files in this working copy.
 */
export const runtime = 'nodejs';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'tools', 'mcp-server.mjs'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export async function GET(request: Request) {
  const root = repoRoot();
  const origin = new URL(request.url).origin;
  const apiOrigin = (process.env.API_ORIGIN ?? 'http://localhost:8000').replace(/\/$/, '');
  const command = 'node';
  const args = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', path.join(root, 'apps', 'web', 'scripts', 'register-test-loader.mjs'), path.join(root, 'tools', 'mcp-server.mjs')];
  const env: Record<string, string> = {
    INTERIOR_API: `${apiOrigin}/api/v1`,
    INTERIOR_STUDIO_URL: origin,
    ...(process.env.API_TOKEN ? { INTERIOR_API_TOKEN: process.env.API_TOKEN } : {}),
  };
  const server = { command, args, env };

  return NextResponse.json({
    root,
    command,
    args,
    env,
    nodeRequirement: 'Node 22.12 or newer (the server loads the repository TypeScript directly)',
    claudeDesktop: { file: process.platform === 'win32' ? '%APPDATA%\\Claude\\claude_desktop_config.json' : '~/Library/Application Support/Claude/claude_desktop_config.json', json: { mcpServers: { 'interior-studio': server } } },
    cursor: { file: '.cursor/mcp.json (project) or ~/.cursor/mcp.json (global)', json: { mcpServers: { 'interior-studio': server } } },
    codex: {
      file: '~/.codex/config.toml',
      toml: [
        '[mcp_servers.interior-studio]',
        `command = "${command}"`,
        `args = [${args.map((a) => JSON.stringify(a)).join(', ')}]`,
        '',
        '[mcp_servers.interior-studio.env]',
        ...Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
      ].join('\n'),
    },
    claudeCode: `claude mcp add interior-studio ${Object.entries(env)
      .map(([k, v]) => `-e ${k}=${v}`)
      .join(' ')} -- ${command} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`,
  });
}
