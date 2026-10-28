import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, writeTeam, writeRegistry, agentsIn, placeTeam } from './helpers.mjs';
import { parseFrontmatter } from '../skill/lib/frontmatter.mjs';
import { validateTeam } from '../skill/lib/team.mjs';

const projectTeams = (sb) => path.join(sb.dirs.project, '.byt', 'teams');
const projectAgents = (sb) => path.join(sb.dirs.project, '.claude', 'agents');
const readAgent = (dir, name) => parseFrontmatter(fs.readFileSync(path.join(dir, 'agents', `${name}.md`), 'utf8'));

const DATA = {
  name: 'web-shop',
  description: 'Build an online shop',
  agents: [
    { name: 'lead', role: 'Coordinates the shop team' },
    { name: 'backend', role: 'Builds the payment API', access: 'exec', model: 'fast' },
    { name: 'reviewer', role: 'Reviews every change', access: 'read', prompt: 'You review code. Be strict, precise and constructive.' },
  ],
};

test('new --data: creates a local team in the project, validated and synced', async () => {
  const sb = sandbox();
  try {
    const r = await sb.bytJson('new', '--data', JSON.stringify(DATA));
    assert.equal(r.json.ok, true, r.stdout);
    const d = r.json.data;
    assert.equal(d.scope, 'project');
    assert.equal(d.version, '0.1.0');
    assert.equal(d.lead, 'lead');
    assert.deepEqual(d.next, ['/byt use web-shop', '/byt run web-shop <task>']);

    const dir = path.join(projectTeams(sb), 'web-shop');
    assert.ok(validateTeam(dir).ok);
    const backend = readAgent(dir, 'backend');
    assert.equal(backend.data.tools, 'Read, Grep, Glob, Edit, Write, Bash', 'tools inferred from the access level');
    assert.equal(backend.data.model, 'haiku', '"fast" → haiku');
    assert.match(backend.body, /You may edit files and run shell commands/);
    assert.equal(readAgent(dir, 'reviewer').data.tools, 'Read, Grep, Glob');
    assert.match(readAgent(dir, 'reviewer').body, /Be strict/, 'the given prompt is kept');
    assert.match(readAgent(dir, 'lead').body, /\*\*backend\*\*: Builds the payment API/, 'the lead knows its team');
    assert.equal(readAgent(dir, 'lead').data.model, 'opus');

    const state = JSON.parse(fs.readFileSync(path.join(sb.dirs.project, '.byt', 'state.json'), 'utf8'));
    assert.equal(state.teams['web-shop'].source, 'local');
    assert.deepEqual(agentsIn(projectAgents(sb)), ['byt-web-shop-backend.md', 'byt-web-shop-lead.md', 'byt-web-shop-reviewer.md']);
  } finally {
    sb.cleanup();
  }
});

test('new --data -: reads the JSON from stdin, and --global', async () => {
  const sb = sandbox();
  try {
    const r = await sb.bytJson('new', 'stdin-team', '--global', '--data', '-', { stdin: JSON.stringify({ ...DATA, name: undefined }) });
    assert.equal(r.json.ok, true, r.stdout);
    assert.equal(r.json.data.team, 'stdin-team');
    assert.equal(r.json.data.scope, 'global');
    assert.ok(fs.existsSync(path.join(sb.dirs.bytHome, 'teams', 'stdin-team', 'team.json')));
  } finally {
    sb.cleanup();
  }
});

test('new: clear errors (invalid JSON, invalid name, duplicate, unknown access, no --data with --json)', async () => {
  const sb = sandbox();
  try {
    assert.equal((await sb.bytJson('new', '--data', '{oops')).json.error.code, 'INVALID_JSON');
    assert.equal((await sb.bytJson('new', '--data', JSON.stringify({ ...DATA, name: 'Bad Name' }))).json.error.code, 'INVALID_NAME');
    assert.equal(
      (await sb.bytJson('new', '--data', JSON.stringify({ ...DATA, agents: [{ name: 'a' }, { name: 'a' }] }))).json.error.code,
      'DUPLICATE_AGENT'
    );
    const badAccess = await sb.byt('new', '--data', JSON.stringify({ ...DATA, agents: [{ name: 'lead', access: 'root' }] }));
    assert.match(badAccess.stderr, /Unknown access level: "root"/);
    assert.equal((await sb.bytJson('new', 'x')).json.error.code, 'DATA_REQUIRED');

    await sb.byt('new', '--data', JSON.stringify(DATA));
    assert.equal((await sb.bytJson('new', '--data', JSON.stringify(DATA))).json.error.code, 'TEAM_EXISTS');
    assert.deepEqual(fs.readdirSync(projectTeams(sb)), ['web-shop'], 'no temporary folder is left behind');
  } finally {
    sb.cleanup();
  }
});

test('new --from: copies an installed team with a new name and version 0.1.0', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', version: '2.3.0', agents: ['lead', 'backend', 'docs'] });
    const r = await sb.bytJson('new', 'my-dev', '--from', 'dev', '--data', JSON.stringify({ description: 'My dev team' }));
    assert.equal(r.json.ok, true, r.stdout);
    assert.equal(r.json.data.from, 'dev');
    const dir = path.join(projectTeams(sb), 'my-dev');
    const team = JSON.parse(fs.readFileSync(path.join(dir, 'team.json'), 'utf8'));
    assert.equal(team.name, 'my-dev');
    assert.equal(team.version, '0.1.0');
    assert.deepEqual(team.agents.map((a) => a.name), ['lead', 'backend', 'docs']);
    assert.match(readAgent(dir, 'backend').body, /focused test agent/, 'original prompt kept');
  } finally {
    sb.cleanup();
  }
});

test('new --from: from the registry, keeping some agents and changing a model', async () => {
  const sb = sandbox();
  try {
    writeTeam(sb.dirs.registry, { name: 'game', agents: ['lead', 'designer', 'tester'] });
    writeRegistry(sb.dirs.registry);
    const data = { name: 'my-game', agents: [{ name: 'lead' }, { name: 'tester', model: 'opus' }, { name: 'artist', role: 'Draws sprites', access: 'write' }] };
    const r = await sb.bytJson('new', '--from', 'game', '--data', JSON.stringify(data));
    assert.equal(r.json.ok, true, r.stdout);
    const dir = path.join(projectTeams(sb), 'my-game');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'agents')).sort(), ['artist.md', 'lead.md', 'tester.md']);
    assert.equal(readAgent(dir, 'tester').data.model, 'opus');
    assert.match(readAgent(dir, 'tester').body, /focused test agent/);
    assert.equal(readAgent(dir, 'artist').data.tools, 'Read, Grep, Glob, Edit, Write');
    assert.ok(!fs.existsSync(path.join(sb.dirs.project, '.byt', 'teams', 'game')), 'the source team is not installed');
  } finally {
    sb.cleanup();
  }
});

test('add-agent and remove-agent', async () => {
  const sb = sandbox();
  try {
    await sb.byt('new', '--data', JSON.stringify(DATA));
    const add = await sb.bytJson('add-agent', 'web-shop', '--data', JSON.stringify({ name: 'docs', role: 'Writes the user guide' }));
    assert.equal(add.json.ok, true, add.stdout);
    assert.equal(add.json.data.agent.access, 'write', 'default access inferred from the "docs" role');
    assert.ok(agentsIn(projectAgents(sb)).includes('byt-web-shop-docs.md'));

    assert.equal((await sb.bytJson('add-agent', 'web-shop', '--data', '{"name":"docs"}')).json.error.code, 'AGENT_EXISTS');

    const rm = await sb.bytJson('remove-agent', 'web-shop', 'docs');
    assert.equal(rm.json.ok, true);
    assert.ok(!agentsIn(projectAgents(sb)).includes('byt-web-shop-docs.md'));
    assert.ok(!fs.existsSync(path.join(projectTeams(sb), 'web-shop', 'agents', 'docs.md')));

    assert.equal((await sb.bytJson('remove-agent', 'web-shop', 'lead')).json.error.code, 'CANNOT_REMOVE_LEAD');
  } finally {
    sb.cleanup();
  }
});

test('update skips local teams; uninstalling a local team requires --force', async () => {
  const sb = sandbox();
  try {
    writeRegistry(sb.dirs.registry);
    await sb.byt('new', '--data', JSON.stringify(DATA));
    const up = await sb.bytJson('update');
    assert.equal(up.json.data.results[0].status, 'local');
    assert.equal((await sb.bytJson('uninstall', 'web-shop')).json.error.code, 'LOCAL_TEAM_DELETE');
    assert.equal((await sb.bytJson('uninstall', 'web-shop', '--force')).json.ok, true);
  } finally {
    sb.cleanup();
  }
});

test('CLI wizard: everything by default with a few Enter presses', async () => {
  const sb = sandbox();
  try {
    writeRegistry(sb.dirs.registry);
    const answers = [
      'quick-team', // nom
      'Ship an API fast', // goal
      '', // project type: web (no starting point offered: empty registry)
      '', // composition : tous
      '', // no extra role
      '', // recommended access/models
      '', // mode subagents
      '', // valider
    ];
    const r = await sb.byt('new', { stdin: answers.join('\n') + '\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Team quick-team v0\.1\.0 created/);
    const team = JSON.parse(fs.readFileSync(path.join(projectTeams(sb), 'quick-team', 'team.json'), 'utf8'));
    assert.deepEqual(team.agents.map((a) => a.name), ['lead', 'architect', 'backend', 'frontend', 'reviewer', 'docs']);
    assert.equal(team.mode, 'subagents');
    assert.equal(readAgent(path.join(projectTeams(sb), 'quick-team'), 'reviewer').data.tools, 'Read, Grep, Glob');
  } finally {
    sb.cleanup();
  }
});

test('CLI wizard: starting point, selection, addition, settings, modification, then confirmation', async () => {
  const sb = sandbox();
  try {
    writeRegistry(sb.dirs.registry);
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend', 'docs'] });
    const answers = [
      'Jeu de plateforme', // objectif (nom fourni en argument)
      '2', // start from "dev"
      '1,2', // keep lead and backend
      'sound-designer', // add a role
      'Creates sound effects', // its role
      '2', // set agent by agent
      '', '', // lead: default access and model
      '', '3', // backend: default access, opus model
      '2', '1', // sound-designer : write, haiku
      '2', // mode agent-team
      '2', // modify an agent
      '1', // the lead
      'Leads the game team', // new role
      '', '', // access, model
      '', // valider
    ];
    const r = await sb.byt('new', 'platformer', { stdin: answers.join('\n') + '\n' });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const dir = path.join(projectTeams(sb), 'platformer');
    const team = JSON.parse(fs.readFileSync(path.join(dir, 'team.json'), 'utf8'));
    assert.deepEqual(team.agents.map((a) => a.name), ['lead', 'backend', 'sound-designer']);
    assert.equal(team.mode, 'agent-team');
    assert.equal(readAgent(dir, 'backend').data.model, 'opus');
    assert.match(readAgent(dir, 'backend').body, /focused test agent/, 'copied agent: original prompt kept');
    assert.equal(readAgent(dir, 'sound-designer').data.tools, 'Read, Grep, Glob, Edit, Write');
    assert.equal(readAgent(dir, 'sound-designer').data.model, 'haiku');
    assert.equal(readAgent(dir, 'lead').data.description, 'Leads the game team', 'role changed → prompt regenerated');
  } finally {
    sb.cleanup();
  }
});

test('CLI wizard: cancellation and end of input', async () => {
  const sb = sandbox();
  try {
    writeRegistry(sb.dirs.registry);
    const cancel = await sb.byt('new', 'x', { stdin: ['But', '', '', '', '', '', '3', ''].join('\n') + '\n' });
    assert.equal(cancel.code, 0);
    assert.match(cancel.stdout, /Creation cancelled/);
    assert.ok(!fs.existsSync(path.join(projectTeams(sb), 'x')));

    const eof = await sb.byt('new', 'y', { stdin: 'But\n' });
    assert.equal(eof.code, 1);
    assert.match(eof.stderr, /Wizard interrupted/);
  } finally {
    sb.cleanup();
  }
});
