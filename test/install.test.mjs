import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, writeTeam, writeRegistry, agentsIn } from './helpers.mjs';

function withRegistry(teams) {
  const sb = sandbox();
  for (const t of teams) writeTeam(sb.dirs.registry, t);
  writeRegistry(sb.dirs.registry);
  return sb;
}

const globalAgents = (sb) => path.join(sb.dirs.claudeDir, 'agents');

test('install : télécharge, enregistre et synchronise', async () => {
  const sb = withRegistry([{ name: 'dev', agents: ['lead', 'backend'] }]);
  try {
    const r = await sb.bytJson('install', 'dev');
    assert.equal(r.json.ok, true, r.stdout);
    assert.equal(r.json.data.scope, 'global');
    assert.ok(fs.existsSync(path.join(sb.dirs.bytHome, 'teams', 'dev', 'agents', 'backend.md')));
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-backend.md', 'byt-dev-lead.md']);
    assert.equal(fs.readdirSync(path.join(sb.dirs.bytHome, 'teams')).filter((f) => f.startsWith('.tmp')).length, 0);

    const state = JSON.parse(fs.readFileSync(path.join(sb.dirs.bytHome, 'state.json'), 'utf8'));
    assert.equal(state.teams.dev.source, 'registry');

    const again = await sb.bytJson('install', 'dev');
    assert.equal(again.json.error.code, 'TEAM_EXISTS');
    const forced = await sb.bytJson('install', 'dev', '--force');
    assert.equal(forced.json.ok, true);
  } finally {
    sb.cleanup();
  }
});

test('install accepte une URL file://', async () => {
  const sb = withRegistry([{ name: 'dev' }]);
  try {
    sb.env.BYT_REGISTRY = pathToFileURL(sb.dirs.registry).href;
    const r = await sb.bytJson('install', 'dev');
    assert.equal(r.json.ok, true, r.stdout);
  } finally {
    sb.cleanup();
  }
});

test('install --project : stockage et agents dans le projet', async () => {
  const sb = withRegistry([{ name: 'dev', agents: ['lead'] }]);
  try {
    const r = await sb.bytJson('install', 'dev', '--project');
    assert.equal(r.json.data.scope, 'project');
    assert.ok(fs.existsSync(path.join(sb.dirs.project, '.byt', 'teams', 'dev', 'team.json')));
    assert.deepEqual(agentsIn(path.join(sb.dirs.project, '.claude', 'agents')), ['byt-dev-lead.md']);
    assert.deepEqual(agentsIn(globalAgents(sb)), []);
    const list = await sb.bytJson('list');
    assert.equal(list.json.data.teams[0].scope, 'project');
  } finally {
    sb.cleanup();
  }
});

test('install : erreurs claires (team inconnue, team invalide, chemin dangereux)', async () => {
  const sb = withRegistry([{ name: 'dev' }, { name: 'broken' }]);
  try {
    const unknown = await sb.byt('install', 'ghost');
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /« ghost » est introuvable dans le registry/);

    fs.rmSync(path.join(sb.dirs.registry, 'teams', 'broken', 'agents', 'worker.md'));
    const reg = JSON.parse(fs.readFileSync(path.join(sb.dirs.registry, 'registry.json'), 'utf8'));
    reg.teams.find((t) => t.name === 'broken').files = ['team.json'];
    reg.teams.find((t) => t.name === 'dev').files = ['team.json', '../../evil.md'];
    fs.writeFileSync(path.join(sb.dirs.registry, 'registry.json'), JSON.stringify(reg));

    const broken = await sb.bytJson('install', 'broken');
    assert.equal(broken.json.error.code, 'TEAM_INVALID');
    assert.ok(!fs.existsSync(path.join(sb.dirs.bytHome, 'teams', 'broken')), 'rien n\'est installé');

    const evil = await sb.bytJson('install', 'dev');
    assert.equal(evil.json.error.code, 'REGISTRY_UNSAFE_PATH');
  } finally {
    sb.cleanup();
  }
});

test('uninstall : supprime la team et nettoie ses agents', async () => {
  const sb = withRegistry([{ name: 'dev' }, { name: 'qa' }]);
  try {
    await sb.byt('install', 'dev');
    await sb.byt('install', 'qa');
    const r = await sb.bytJson('uninstall', 'dev');
    assert.equal(r.json.ok, true);
    assert.ok(!fs.existsSync(path.join(sb.dirs.bytHome, 'teams', 'dev')));
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-qa-lead.md', 'byt-qa-worker.md']);
    const again = await sb.bytJson('uninstall', 'dev');
    assert.equal(again.json.error.code, 'TEAM_NOT_INSTALLED');
  } finally {
    sb.cleanup();
  }
});

test('update : met à jour en conservant les agents désactivés, ignore les teams à jour', async () => {
  const sb = withRegistry([{ name: 'dev', agents: ['lead', 'backend', 'docs'] }]);
  try {
    await sb.byt('install', 'dev');
    await sb.byt('disable', 'dev', 'docs');

    const same = await sb.bytJson('update');
    assert.equal(same.json.data.results[0].status, 'up-to-date');

    writeTeam(sb.dirs.registry, { name: 'dev', version: '1.1.0', agents: ['lead', 'backend', 'docs', 'frontend'] });
    writeRegistry(sb.dirs.registry);
    const r = await sb.bytJson('update', 'dev');
    assert.deepEqual(r.json.data.results[0], { team: 'dev', scope: 'global', status: 'updated', from: '1.0.0', version: '1.1.0' });

    const team = JSON.parse(fs.readFileSync(path.join(sb.dirs.bytHome, 'teams', 'dev', 'team.json'), 'utf8'));
    assert.equal(team.agents.find((a) => a.name === 'docs').enabled, false, 'docs reste désactivé');
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-backend.md', 'byt-dev-frontend.md', 'byt-dev-lead.md']);
  } finally {
    sb.cleanup();
  }
});

test('list --available, search et info', async () => {
  const sb = withRegistry([
    { name: 'dev', tags: ['backend', 'web'], description: 'Développement logiciel' },
    { name: 'game', tags: ['jeu'], description: 'Création de jeux vidéo' },
  ]);
  try {
    await sb.byt('install', 'dev');
    const avail = await sb.bytJson('list', '--available');
    assert.deepEqual(avail.json.data.teams.map((t) => [t.name, t.installed]), [['dev', true], ['game', false]]);

    const s = await sb.bytJson('search', 'VIDEO');
    assert.deepEqual(s.json.data.results.map((t) => t.name), ['game'], 'recherche insensible à la casse et aux accents');
    const byTag = await sb.bytJson('search', 'backend');
    assert.deepEqual(byTag.json.data.results.map((t) => t.name), ['dev']);

    const installed = await sb.bytJson('info', 'dev');
    assert.equal(installed.json.data.installed, true);
    assert.equal(installed.json.data.agents[0].subagent, 'byt-dev-lead');
    assert.equal(installed.json.data.agents[0].synced, true);
    assert.deepEqual(installed.json.data.agents[0].tools, ['Read', 'Grep', 'Glob']);

    const remote = await sb.byt('info', 'game');
    assert.match(remote.stdout, /non installée/);
    assert.match(remote.stdout, /\/byt install game/);
  } finally {
    sb.cleanup();
  }
});

test('registry injoignable : message clair', async () => {
  const sb = sandbox();
  try {
    sb.env.BYT_REGISTRY = 'http://127.0.0.1:9';
    const r = await sb.byt('list', '--available');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Impossible de joindre le registry/);
  } finally {
    sb.cleanup();
  }
});
