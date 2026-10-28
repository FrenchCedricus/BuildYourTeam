import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, writeTeam, writeRegistry, placeTeam, agentsIn } from './helpers.mjs';

const UNREACHABLE = 'http://127.0.0.1:9';

function withRegistry(teams) {
  const sb = sandbox();
  for (const t of teams) writeTeam(sb.dirs.registry, t);
  writeRegistry(sb.dirs.registry);
  return sb;
}

const registryFile = (sb) => path.join(sb.dirs.registry, 'registry.json');
const readRegistry = (sb) => JSON.parse(fs.readFileSync(registryFile(sb), 'utf8'));
const writeRegistryJson = (sb, reg) => fs.writeFileSync(registryFile(sb), JSON.stringify(reg));
const globalTeams = (sb) => path.join(sb.dirs.bytHome, 'teams');
const globalAgents = (sb) => path.join(sb.dirs.claudeDir, 'agents');
const tmpDirsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('.tmp')) : []);
const stateOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));

test('corrupted registry: invalid JSON, missing teams list, registry.json not found', async () => {
  const sb = withRegistry([{ name: 'dev' }]);
  try {
    fs.writeFileSync(registryFile(sb), '{ not json');
    const bad = await sb.bytJson('list', '--available');
    assert.equal(bad.code, 1);
    assert.equal(bad.json.error.code, 'INVALID_JSON');
    assert.match(bad.json.error.message, /registry\.json/);

    fs.writeFileSync(registryFile(sb), JSON.stringify({ schema: 1 }));
    const noTeams = await sb.bytJson('install', 'dev');
    assert.equal(noTeams.json.error.code, 'REGISTRY_INVALID');
    assert.match(noTeams.json.error.message, /"teams" list is missing/);

    fs.rmSync(registryFile(sb));
    const missing = await sb.bytJson('search', 'dev');
    assert.equal(missing.json.error.code, 'REGISTRY_FILE_MISSING');
    const text = await sb.byt('list', '--available');
    assert.equal(text.code, 1);
    assert.match(text.stderr, /File not found in the registry/);
    assert.ok(!fs.existsSync(path.join(globalTeams(sb), 'dev')), 'nothing is installed');
  } finally {
    sb.cleanup();
  }
});

test('install: absolute entry.path or one with .., file with backslash .. → REGISTRY_UNSAFE_PATH', async () => {
  const sb = withRegistry([{ name: 'dev' }]);
  try {
    const original = readRegistry(sb);
    const variants = [
      (e) => { e.path = path.join(sb.dirs.registry, 'teams', 'dev'); },
      (e) => { e.path = '../registry/teams/dev'; },
      (e) => { e.path = 'teams/../teams/dev'; },
      (e) => { e.files = ['team.json', 'agents\\..\\..\\evil.md']; },
    ];
    for (const mutate of variants) {
      const reg = structuredClone(original);
      mutate(reg.teams[0]);
      writeRegistryJson(sb, reg);
      const r = await sb.bytJson('install', 'dev');
      assert.equal(r.json.error.code, 'REGISTRY_UNSAFE_PATH', JSON.stringify(reg.teams[0]));
      assert.ok(!fs.existsSync(path.join(globalTeams(sb), 'dev')));
      assert.deepEqual(tmpDirsIn(globalTeams(sb)), [], 'no temporary folder is left behind');
    }
    assert.ok(!fs.existsSync(path.join(sb.dirs.root, 'evil.md')));
    assert.deepEqual(agentsIn(globalAgents(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('install: file listed but missing from the registry → error, no .tmp and no team installed', async () => {
  const sb = withRegistry([{ name: 'dev', agents: ['lead', 'worker'] }]);
  try {
    fs.rmSync(path.join(sb.dirs.registry, 'teams', 'dev', 'agents', 'worker.md'));
    const r = await sb.bytJson('install', 'dev');
    assert.equal(r.code, 1);
    assert.equal(r.json.error.code, 'REGISTRY_FILE_MISSING');
    assert.match(r.json.error.message, /worker\.md/);
    assert.ok(!fs.existsSync(path.join(globalTeams(sb), 'dev')));
    assert.deepEqual(tmpDirsIn(globalTeams(sb)), []);
    const state = fs.existsSync(path.join(sb.dirs.bytHome, 'state.json')) ? stateOf(sb.dirs.bytHome) : { teams: {} };
    assert.equal(state.teams.dev, undefined, 'the team is not recorded');
    assert.deepEqual(agentsIn(globalAgents(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('install: invalid name refused before any registry access; orphan folder → TEAM_EXISTS', async () => {
  const sb = sandbox();
  try {
    sb.env.BYT_REGISTRY = UNREACHABLE; // any registry access would fail with REGISTRY_UNREACHABLE
    for (const name of ['Bad Name', '../evil', 'UPPER', 'a_b']) {
      const r = await sb.bytJson('install', name);
      assert.equal(r.json.error.code, 'INVALID_NAME', name);
    }
    const noName = await sb.bytJson('install');
    assert.equal(noName.json.error.code, 'USAGE');

    // a team folder without an entry in state.json blocks the installation
    fs.mkdirSync(path.join(globalTeams(sb), 'orphan'), { recursive: true });
    const orphan = await sb.bytJson('install', 'orphan');
    assert.equal(orphan.json.error.code, 'TEAM_EXISTS');
    assert.ok(fs.existsSync(path.join(globalTeams(sb), 'orphan')), 'the existing folder is not touched');
  } finally {
    sb.cleanup();
  }
});

test('update: missing from the registry, --force on the same version, a disabled team stays disabled, nothing to update without a registry', async () => {
  const sb = withRegistry([{ name: 'dev', agents: ['lead', 'backend'] }]);
  try {
    // nothing installed: no registry request
    sb.env.BYT_REGISTRY = UNREACHABLE;
    const empty = await sb.bytJson('update');
    assert.equal(empty.json.ok, true);
    assert.deepEqual(empty.json.data.results, []);
    assert.match((await sb.byt('update')).stdout, /No installed team to update/);
    sb.env.BYT_REGISTRY = sb.dirs.registry;

    await sb.byt('install', 'dev');
    placeTeam(sb, { name: 'ghost', agents: ['lead'] });

    const r = await sb.bytJson('update');
    const byTeam = Object.fromEntries(r.json.data.results.map((x) => [x.team, x]));
    assert.equal(byTeam.ghost.status, 'not-in-registry');
    assert.equal(byTeam.dev.status, 'up-to-date');
    assert.match((await sb.byt('update', 'ghost')).stdout, /not in the registry, skipped/);

    await sb.byt('disable', 'dev');
    const forced = await sb.bytJson('update', 'dev', '--force');
    assert.deepEqual(forced.json.data.results[0], { team: 'dev', scope: 'global', status: 'updated', from: '1.0.0', version: '1.0.0' });
    assert.equal(stateOf(sb.dirs.bytHome).teams.dev.enabled, false, 'the team stays disabled');
    assert.deepEqual(agentsIn(globalAgents(sb)).filter((f) => f.startsWith('byt-dev-')), [], 'no agent synced again');
    assert.deepEqual(tmpDirsIn(globalTeams(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('info: not found anywhere, unreachable registry → TEAM_NOT_INSTALLED; agent-team warning depending on CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', async () => {
  const sb = withRegistry([{ name: 'dev' }]);
  try {
    const nowhere = await sb.bytJson('info', 'ghost');
    assert.equal(nowhere.code, 1);
    assert.equal(nowhere.json.error.code, 'TEAM_NOT_INSTALLED');

    sb.env.BYT_REGISTRY = UNREACHABLE;
    const offline = await sb.bytJson('info', 'dev');
    assert.equal(offline.json.error.code, 'TEAM_NOT_INSTALLED');
    const offlineText = await sb.byt('info', 'dev');
    assert.match(offlineText.stderr, /"dev" is not installed/);

    placeTeam(sb, { name: 'swarm', mode: 'agent-team', agents: ['lead', 'worker'] });
    const warned = await sb.byt('info', 'swarm');
    assert.equal(warned.code, 0);
    assert.match(warned.stdout, /agent-team mode: the experimental feature is not enabled/);
    assert.equal((await sb.bytJson('info', 'swarm')).json.data.agentTeamsEnabled, false);

    sb.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    const enabled = await sb.byt('info', 'swarm');
    assert.doesNotMatch(enabled.stdout, /experimental feature/);
    assert.equal((await sb.bytJson('info', 'swarm')).json.data.agentTeamsEnabled, true);

    sb.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '0';
    assert.match((await sb.byt('info', 'swarm')).stdout, /experimental feature/, '"0" means disabled');
  } finally {
    sb.cleanup();
  }
});

test('search: no word → USAGE, no result → message', async () => {
  const sb = withRegistry([{ name: 'dev', tags: ['web'] }]);
  try {
    const none = await sb.bytJson('search');
    assert.equal(none.json.error.code, 'USAGE');
    const blank = await sb.byt('search', '   ');
    assert.equal(blank.code, 1);
    assert.match(blank.stderr, /Usage: byt search <word>/);

    const empty = await sb.bytJson('search', 'licorne');
    assert.equal(empty.json.ok, true);
    assert.deepEqual(empty.json.data.results, []);
    const text = await sb.byt('search', 'licorne');
    assert.equal(text.code, 0);
    assert.match(text.stdout, /No team matches "licorne"/);
  } finally {
    sb.cleanup();
  }
});
