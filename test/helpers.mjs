import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable, PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createContext } from '../skill/lib/context.mjs';
import { main } from '../skill/lib/cli.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// An isolated environment: fake ~/.byt, fake ~/.claude, a project folder,
// and a local registry (file://) built from test teams.
export function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'byt-test-'));
  const dirs = {
    root,
    bytHome: path.join(root, 'home', '.byt'),
    claudeDir: path.join(root, 'home', '.claude'),
    project: path.join(root, 'project'),
    registry: path.join(root, 'registry'),
  };
  fs.mkdirSync(dirs.project, { recursive: true });
  fs.mkdirSync(dirs.registry, { recursive: true });
  const env = {
    BYT_HOME: dirs.bytHome,
    BYT_CLAUDE_DIR: dirs.claudeDir,
    BYT_REGISTRY: dirs.registry,
    NO_COLOR: '1',
  };
  const ctx = () => createContext({ env: { ...env }, cwd: dirs.project });

  async function byt(...argv) {
    const out = capture();
    const err = capture();
    const opts = typeof argv.at(-1) === 'object' ? argv.pop() : {};
    const stdin = opts.stdin !== undefined ? streamOf(opts.stdin) : streamOf('');
    const code = await main(argv, { ctx: ctx(), stdout: out, stderr: err, stdin });
    return { code, stdout: out.text(), stderr: err.text() };
  }

  async function bytJson(...argv) {
    const opts = typeof argv.at(-1) === 'object' ? argv.pop() : {};
    const r = await byt(...argv, '--json', opts);
    try {
      return { ...r, json: JSON.parse(r.stdout) };
    } catch {
      throw new Error(`Invalid JSON output for "${argv.join(' ')}":\n${r.stdout}\n${r.stderr}`);
    }
  }

  return {
    dirs,
    env,
    ctx,
    byt,
    bytJson,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function capture() {
  const chunks = [];
  const w = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  w.text = () => chunks.join('');
  return w;
}

export function streamOf(text) {
  const s = new PassThrough();
  s.end(text);
  return s;
}

export function agentMd({ name, description = `Agent ${name}`, tools = 'Read, Grep, Glob', model = 'sonnet', body }) {
  return `---\nname: ${name}\ndescription: ${description}\ntools: ${tools}\nmodel: ${model}\n---\n\n${body ?? `You are ${name}, a focused test agent that reports back to the lead.`}\n`;
}

// Writes a valid team into a `teams/<name>` folder of the test registry.
export function writeTeam(baseDir, { name, version = '1.0.0', agents = ['lead', 'worker'], lead = agents[0], mode = 'subagents', tags = ['test'], description } = {}) {
  const dir = path.join(baseDir, 'teams', name);
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  const team = {
    name,
    version,
    description: description ?? `Test team ${name}`,
    author: 'tests',
    tags,
    lead,
    mode,
    agents: agents.map((a) => ({ name: a, enabled: true })),
  };
  fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify(team, null, 2));
  for (const a of agents) fs.writeFileSync(path.join(dir, 'agents', `${a}.md`), agentMd({ name: a }));
  return dir;
}

// Generates the registry.json matching the teams in baseDir/teams.
export function writeRegistry(baseDir) {
  const teamsDir = path.join(baseDir, 'teams');
  const teams = fs.existsSync(teamsDir)
    ? fs.readdirSync(teamsDir).map((name) => {
        const team = JSON.parse(fs.readFileSync(path.join(teamsDir, name, 'team.json'), 'utf8'));
        return {
          name: team.name,
          version: team.version,
          description: team.description,
          author: team.author,
          tags: team.tags,
          mode: team.mode,
          path: `teams/${name}`,
          files: ['team.json', ...team.agents.map((a) => `agents/${a.name}.md`)],
        };
      })
    : [];
  fs.writeFileSync(path.join(baseDir, 'registry.json'), JSON.stringify({ schema: 1, teams }, null, 2));
}

// Installs a team directly in a scope (without going through the registry).
export function placeTeam(sb, { scope = 'global', ...opts }) {
  const base = scope === 'project' ? path.join(sb.dirs.project, '.byt') : sb.dirs.bytHome;
  const dir = writeTeam(base, opts);
  const statePath = path.join(base, 'state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { teams: {}, synced: [] };
  state.teams[opts.name] = { version: opts.version ?? '1.0.0', source: 'registry', enabled: true };
  fs.writeFileSync(statePath, JSON.stringify(state));
  return dir;
}

export function agentsIn(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}
