import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, writeTeam, writeRegistry, placeTeam, agentsIn, agentMd, REPO_ROOT } from './helpers.mjs';

const UNREACHABLE = 'http://127.0.0.1:9';
const projectTeams = (sb) => path.join(sb.dirs.project, '.byt', 'teams');
const projectAgents = (sb) => path.join(sb.dirs.project, '.claude', 'agents');
const globalAgents = (sb) => path.join(sb.dirs.claudeDir, 'agents');
const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const readJsonFile = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const newData = (overrides = {}) =>
  JSON.stringify({ name: 'shop', description: 'Build a shop', agents: [{ name: 'alpha' }, { name: 'beta' }], ...overrides });

test('same team in project and global scope: project first, --global targets global (uninstall, info)', async () => {
  const sb = sandbox();
  try {
    const globalDir = placeTeam(sb, { name: 'dev', version: '1.0.0' });
    const projectDir = placeTeam(sb, { name: 'dev', version: '2.0.0', scope: 'project' });

    const info = await sb.bytJson('info', 'dev');
    assert.equal(info.json.data.scope, 'project');
    assert.equal(info.json.data.version, '2.0.0');
    const infoGlobal = await sb.bytJson('info', 'dev', '--global');
    assert.equal(infoGlobal.json.data.scope, 'global');
    assert.equal(infoGlobal.json.data.version, '1.0.0');

    const un = await sb.bytJson('uninstall', 'dev', '--global');
    assert.equal(un.json.data.scope, 'global');
    assert.ok(!fs.existsSync(globalDir));
    assert.ok(fs.existsSync(projectDir), 'the project team is intact');
    assert.equal((await sb.bytJson('info', 'dev', '--global')).json.error.code, 'TEAM_NOT_INSTALLED');

    const rest = await sb.bytJson('uninstall', 'dev');
    assert.equal(rest.json.data.scope, 'project');
    assert.ok(!fs.existsSync(projectDir));
  } finally {
    sb.cleanup();
  }
});

test('corrupted state.json → INVALID_JSON, exit code 1', async () => {
  const sb = sandbox();
  try {
    fs.mkdirSync(sb.dirs.bytHome, { recursive: true });
    fs.writeFileSync(path.join(sb.dirs.bytHome, 'state.json'), '{ "teams": ');
    const j = await sb.bytJson('list');
    assert.equal(j.code, 1);
    assert.equal(j.json.ok, false);
    assert.equal(j.json.error.code, 'INVALID_JSON');
    const t = await sb.byt('sync');
    assert.equal(t.code, 1);
    assert.match(t.stderr, /Invalid JSON .*state\.json/);
  } finally {
    sb.cleanup();
  }
});

test('list text: broken team, disabled team, lead marked', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    const broken = placeTeam(sb, { name: 'broken', agents: ['lead'] });
    fs.rmSync(path.join(broken, 'team.json'));
    placeTeam(sb, { name: 'sleepy', agents: ['lead'] });
    await sb.byt('disable', 'sleepy');

    const r = await sb.byt('list');
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Installed teams \(3\)/);
    assert.match(r.stdout, /broken v1\.0\.0 .*\n\s+team\.json not found — reinstall the team/);
    assert.match(r.stdout, /sleepy v1\.0\.0\s+○ inactive/);
    assert.match(r.stdout, /dev v1\.0\.0\s+● active/);
    assert.match(r.stdout, /✔ lead \(lead\)\s+✔ backend/);
    assert.doesNotMatch(r.stdout, /backend \(lead\)/);

    const j = await sb.bytJson('list');
    const byName = Object.fromEntries(j.json.data.teams.map((t) => [t.name, t]));
    assert.equal(byName.broken.broken, true);
    assert.equal(byName.sleepy.enabled, false);
    assert.equal(byName.dev.lead, 'lead');
  } finally {
    sb.cleanup();
  }
});

test('enable/disable: warning when the lead is disabled, agent enabled in a disabled team, no argument → USAGE', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    const off = await sb.bytJson('disable', 'dev', 'lead');
    assert.equal(off.json.ok, true);
    assert.match(off.json.data.warnings.join('\n'), /"lead" is the lead/);
    assert.deepEqual((await sb.bytJson('disable', 'dev', 'backend')).json.data.warnings, []);

    await sb.byt('disable', 'dev');
    const on = await sb.byt('enable', 'dev', 'backend');
    assert.equal(on.code, 0);
    assert.match(on.stdout, /warning\s+Team "dev" is disabled: enable it with \/byt enable dev/);
    assert.deepEqual(agentsIn(globalAgents(sb)), [], 'disabled team: no agent synced');

    for (const cmd of ['enable', 'disable']) {
      const r = await sb.bytJson(cmd);
      assert.equal(r.json.error.code, 'USAGE', cmd);
      assert.match(r.json.error.hint, new RegExp(`byt ${cmd} <team> \\[agent\\]`));
    }
  } finally {
    sb.cleanup();
  }
});

test('validate: no team, installed team by name, --strict on a warning, error.data.results in JSON', async () => {
  const sb = sandbox();
  try {
    const none = await sb.byt('validate');
    assert.equal(none.code, 0);
    assert.match(none.stdout, /No team to validate/);

    const dir = placeTeam(sb, { name: 'dev', agents: ['lead', 'worker'] });
    const ok = await sb.bytJson('validate', 'dev');
    assert.equal(ok.json.ok, true);
    assert.deepEqual(ok.json.data.results.map((r) => [r.label, r.ok]), [['dev', true]]);
    assert.equal(ok.json.data.results[0].dir, dir);

    // unknown tool: only a warning, blocking with --strict
    fs.writeFileSync(path.join(dir, 'agents', 'worker.md'), agentMd({ name: 'worker', tools: 'Read, Foo' }));
    const lax = await sb.bytJson('validate', 'dev');
    assert.equal(lax.json.ok, true);
    assert.match(lax.json.data.results[0].warnings.join('\n'), /unknown tool "Foo"/);

    const strict = await sb.bytJson('validate', 'dev', '--strict');
    assert.equal(strict.code, 1);
    assert.equal(strict.json.error.code, 'VALIDATION_FAILED');
    assert.match(strict.json.error.message, /strict mode/);
    assert.equal(strict.json.error.data.results[0].ok, false);
    assert.deepEqual(strict.json.error.data.results[0].errors, []);

    const strictText = await sb.byt('validate', '--strict');
    assert.equal(strictText.code, 1);
    assert.match(strictText.stdout, /✖ dev \(global\): invalid/);
    assert.match(strictText.stderr, /Validation failed \(strict mode\)/);

    assert.equal((await sb.bytJson('validate', 'ghost')).json.error.code, 'TEAM_NOT_INSTALLED');
  } finally {
    sb.cleanup();
  }
});

test('new --data: MISSING_DESCRIPTION, NO_AGENTS, INVALID_LEAD, INVALID_MODE, INVALID_MODEL, no .tmp left', async () => {
  const sb = sandbox();
  try {
    const cases = [
      [{ description: '' }, 'MISSING_DESCRIPTION'],
      [{ description: undefined }, 'MISSING_DESCRIPTION'],
      [{ agents: [] }, 'NO_AGENTS'],
      [{ agents: undefined }, 'NO_AGENTS'],
      [{ lead: 'gamma' }, 'INVALID_LEAD'],
      [{ mode: 'swarm' }, 'INVALID_MODE'],
      [{ agents: [{ name: 'alpha' }, { name: 'beta', model: 'gpt-4' }] }, 'INVALID_MODEL'],
    ];
    for (const [overrides, code] of cases) {
      const r = await sb.bytJson('new', '--data', newData(overrides));
      assert.equal(r.code, 1);
      assert.equal(r.json.error.code, code, JSON.stringify(overrides));
      assert.deepEqual(entries(projectTeams(sb)), [], `no folder left (${code})`);
    }
    assert.deepEqual(entries(projectAgents(sb)), []);
    assert.ok(!fs.existsSync(path.join(sb.dirs.project, '.byt', 'state.json')), 'no team recorded');
  } finally {
    sb.cleanup();
  }
});

test('new --data: explicit lead, default lead = first agent, --force replaces, agent-team mode', async () => {
  const sb = sandbox();
  try {
    const explicit = await sb.bytJson('new', '--data', newData({ lead: 'beta' }));
    assert.equal(explicit.json.data.lead, 'beta');
    assert.equal(readJsonFile(path.join(projectTeams(sb), 'shop', 'team.json')).lead, 'beta');
    assert.deepEqual(explicit.json.data.agents.map((a) => [a.name, a.lead]), [['alpha', false], ['beta', true]]);

    const byDefault = await sb.bytJson('new', '--data', newData({ name: 'other' }));
    assert.equal(byDefault.json.data.lead, 'alpha');

    assert.equal((await sb.bytJson('new', '--data', newData({ agents: [{ name: 'gamma' }] }))).json.error.code, 'TEAM_EXISTS');
    const forced = await sb.bytJson('new', '--force', '--data', newData({ agents: [{ name: 'gamma' }], mode: 'agent-team' }));
    assert.equal(forced.json.ok, true, forced.stdout);
    assert.equal(forced.json.data.mode, 'agent-team');
    assert.equal(forced.json.data.lead, 'gamma');
    const dir = path.join(projectTeams(sb), 'shop');
    const team = readJsonFile(path.join(dir, 'team.json'));
    assert.equal(team.mode, 'agent-team');
    assert.deepEqual(team.agents.map((a) => a.name), ['gamma']);
    assert.deepEqual(entries(path.join(dir, 'agents')), ['gamma.md'], 'the old agents are deleted');
    assert.deepEqual(entries(projectAgents(sb)), ['byt-other-alpha.md', 'byt-other-beta.md', 'byt-shop-gamma.md']);
    assert.deepEqual(entries(projectTeams(sb)), ['other', 'shop']);
  } finally {
    sb.cleanup();
  }
});

test('new --from: unknown → TEAM_NOT_IN_REGISTRY, unreachable registry → TEAM_NOT_INSTALLED, temporary folder cleaned up', async () => {
  const sb = sandbox();
  try {
    writeTeam(sb.dirs.registry, { name: 'game', agents: ['lead', 'tester'] });
    writeRegistry(sb.dirs.registry);
    const data = JSON.stringify({ name: 'mine', description: 'Mon jeu' });

    const unknown = await sb.bytJson('new', '--from', 'ghost', '--data', data);
    assert.equal(unknown.json.error.code, 'TEAM_NOT_IN_REGISTRY');

    // failure after downloading the source: the temporary folder is removed
    const failing = await sb.bytJson('new', '--from', 'game', '--data', JSON.stringify({ name: 'mine', agents: [{ name: 'lead', model: 'gpt-4' }] }));
    assert.equal(failing.json.error.code, 'INVALID_MODEL');
    assert.deepEqual(entries(projectTeams(sb)), []);

    const ok = await sb.bytJson('new', '--from', 'game', '--data', data);
    assert.equal(ok.json.ok, true, ok.stdout);
    assert.deepEqual(entries(projectTeams(sb)), ['mine'], 'the downloaded source is cleaned up');

    sb.env.BYT_REGISTRY = UNREACHABLE;
    const offline = await sb.bytJson('new', '--from', 'game', '--data', JSON.stringify({ name: 'mine2', description: 'x' }));
    assert.equal(offline.json.error.code, 'TEAM_NOT_INSTALLED');
    assert.deepEqual(entries(projectTeams(sb)), ['mine']);
  } finally {
    sb.cleanup();
  }
});

test('add-agent: registry team warning, team via data.team, --json without --data → DATA_REQUIRED, no team → USAGE', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead'] });
    const add = await sb.bytJson('add-agent', 'dev', '--data', JSON.stringify({ name: 'docs', role: 'Writes the docs' }));
    assert.equal(add.json.ok, true, add.stdout);
    assert.match(add.json.data.warnings.join('\n'), /comes from the registry: an update will overwrite this addition/);
    assert.ok(agentsIn(globalAgents(sb)).includes('byt-dev-docs.md'));

    const viaData = await sb.bytJson('add-agent', '--data', JSON.stringify({ team: 'dev', name: 'qa', role: 'Tests everything' }));
    assert.equal(viaData.json.ok, true, viaData.stdout);
    assert.equal(viaData.json.data.team, 'dev');
    assert.deepEqual(readJsonFile(path.join(sb.dirs.bytHome, 'teams', 'dev', 'team.json')).agents.map((a) => a.name), ['lead', 'docs', 'qa']);

    await sb.byt('new', '--data', newData());
    const local = await sb.bytJson('add-agent', 'shop', '--data', JSON.stringify({ name: 'gamma' }));
    assert.equal(local.json.ok, true);
    assert.doesNotMatch(local.json.data.warnings.join('\n'), /comes from the registry/, 'no warning for a local team');

    assert.equal((await sb.bytJson('add-agent', 'dev')).json.error.code, 'DATA_REQUIRED');
    assert.equal((await sb.bytJson('add-agent', '--data', '{"name":"x"}')).json.error.code, 'USAGE');
    assert.equal((await sb.bytJson('add-agent', 'ghost', '--data', '{"name":"x"}')).json.error.code, 'TEAM_NOT_INSTALLED');
  } finally {
    sb.cleanup();
  }
});

test('remove-agent unknown agent / missing arguments; run → RUN_REQUIRES_CLAUDE; --version; install --help → help; config without arguments lists paths', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'worker'] });
    assert.equal((await sb.bytJson('remove-agent', 'dev', 'ghost')).json.error.code, 'AGENT_NOT_FOUND');
    assert.equal((await sb.bytJson('remove-agent', 'dev')).json.error.code, 'USAGE');
    assert.equal((await sb.bytJson('remove-agent')).json.error.code, 'USAGE');
    assert.deepEqual(entries(path.join(sb.dirs.bytHome, 'teams', 'dev', 'agents')), ['lead.md', 'worker.md']);

    const run = await sb.byt('run', 'dev', 'write', 'some', 'tests');
    assert.equal(run.code, 1);
    assert.match(run.stderr, /works inside Claude Code/);
    assert.equal((await sb.bytJson('run', 'dev', 'x')).json.error.code, 'RUN_REQUIRES_CLAUDE');

    const pkg = readJsonFile(path.join(REPO_ROOT, 'package.json'));
    const v = await sb.byt('--version');
    assert.equal(v.code, 0);
    assert.equal(v.stdout.trim(), pkg.version);
    assert.equal((await sb.bytJson('--version')).json.data.version, pkg.version);

    sb.env.BYT_REGISTRY = UNREACHABLE;
    const help = await sb.byt('install', 'game', '--help');
    assert.equal(help.code, 0);
    assert.match(help.stdout, /BuildYourTeam/);
    assert.match(help.stdout, /install <team>/);
    assert.ok(!fs.existsSync(path.join(sb.dirs.bytHome, 'teams', 'game')), 'l\'aide n\'installe rien');

    const cfg = await sb.bytJson('config');
    assert.deepEqual(cfg.json.data.paths, { bytHome: sb.dirs.bytHome, claudeDir: sb.dirs.claudeDir });
    assert.equal(cfg.json.data.config.registry, UNREACHABLE, 'BYT_REGISTRY overrides the configuration');
    const cfgText = await sb.byt('config');
    assert.match(cfgText.stdout, /Configuration/);
    assert.ok(cfgText.stdout.includes(path.join(sb.dirs.bytHome, 'config.json')));
  } finally {
    sb.cleanup();
  }
});
