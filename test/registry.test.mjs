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

test('registry corrompu : JSON invalide, liste teams absente, registry.json introuvable', async () => {
  const sb = withRegistry([{ name: 'dev' }]);
  try {
    fs.writeFileSync(registryFile(sb), '{ pas du json');
    const bad = await sb.bytJson('list', '--available');
    assert.equal(bad.code, 1);
    assert.equal(bad.json.error.code, 'INVALID_JSON');
    assert.match(bad.json.error.message, /registry\.json/);

    fs.writeFileSync(registryFile(sb), JSON.stringify({ schema: 1 }));
    const noTeams = await sb.bytJson('install', 'dev');
    assert.equal(noTeams.json.error.code, 'REGISTRY_INVALID');
    assert.match(noTeams.json.error.message, /« teams » est absente/);

    fs.rmSync(registryFile(sb));
    const missing = await sb.bytJson('search', 'dev');
    assert.equal(missing.json.error.code, 'REGISTRY_FILE_MISSING');
    const text = await sb.byt('list', '--available');
    assert.equal(text.code, 1);
    assert.match(text.stderr, /Fichier introuvable dans le registry/);
    assert.ok(!fs.existsSync(path.join(globalTeams(sb), 'dev')), 'rien n\'est installé');
  } finally {
    sb.cleanup();
  }
});

test('install : entry.path absolu ou avec .., fichier avec antislash .. → REGISTRY_UNSAFE_PATH', async () => {
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
      assert.deepEqual(tmpDirsIn(globalTeams(sb)), [], 'aucun dossier temporaire ne traîne');
    }
    assert.ok(!fs.existsSync(path.join(sb.dirs.root, 'evil.md')));
    assert.deepEqual(agentsIn(globalAgents(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('install : fichier listé mais absent du registry → erreur, aucun .tmp ni team installée', async () => {
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
    assert.equal(state.teams.dev, undefined, 'la team n\'est pas enregistrée');
    assert.deepEqual(agentsIn(globalAgents(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('install : nom invalide refusé avant tout accès au registry ; dossier orphelin → TEAM_EXISTS', async () => {
  const sb = sandbox();
  try {
    sb.env.BYT_REGISTRY = UNREACHABLE; // tout accès au registry échouerait avec REGISTRY_UNREACHABLE
    for (const name of ['Bad Name', '../evil', 'UPPER', 'a_b']) {
      const r = await sb.bytJson('install', name);
      assert.equal(r.json.error.code, 'INVALID_NAME', name);
    }
    const noName = await sb.bytJson('install');
    assert.equal(noName.json.error.code, 'USAGE');

    // un dossier de team sans entrée dans state.json bloque l'installation
    fs.mkdirSync(path.join(globalTeams(sb), 'orphan'), { recursive: true });
    const orphan = await sb.bytJson('install', 'orphan');
    assert.equal(orphan.json.error.code, 'TEAM_EXISTS');
    assert.ok(fs.existsSync(path.join(globalTeams(sb), 'orphan')), 'le dossier existant n\'est pas touché');
  } finally {
    sb.cleanup();
  }
});

test('update : absente du registry, --force même version, team désactivée reste désactivée, rien à mettre à jour sans registry', async () => {
  const sb = withRegistry([{ name: 'dev', agents: ['lead', 'backend'] }]);
  try {
    // rien d'installé : aucune requête au registry
    sb.env.BYT_REGISTRY = UNREACHABLE;
    const empty = await sb.bytJson('update');
    assert.equal(empty.json.ok, true);
    assert.deepEqual(empty.json.data.results, []);
    assert.match((await sb.byt('update')).stdout, /Aucune team installée à mettre à jour/);
    sb.env.BYT_REGISTRY = sb.dirs.registry;

    await sb.byt('install', 'dev');
    placeTeam(sb, { name: 'ghost', agents: ['lead'] });

    const r = await sb.bytJson('update');
    const byTeam = Object.fromEntries(r.json.data.results.map((x) => [x.team, x]));
    assert.equal(byTeam.ghost.status, 'not-in-registry');
    assert.equal(byTeam.dev.status, 'up-to-date');
    assert.match((await sb.byt('update', 'ghost')).stdout, /absente du registry, ignorée/);

    await sb.byt('disable', 'dev');
    const forced = await sb.bytJson('update', 'dev', '--force');
    assert.deepEqual(forced.json.data.results[0], { team: 'dev', scope: 'global', status: 'updated', from: '1.0.0', version: '1.0.0' });
    assert.equal(stateOf(sb.dirs.bytHome).teams.dev.enabled, false, 'la team reste désactivée');
    assert.deepEqual(agentsIn(globalAgents(sb)).filter((f) => f.startsWith('byt-dev-')), [], 'aucun agent resynchronisé');
    assert.deepEqual(tmpDirsIn(globalTeams(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('info : introuvable partout, registry injoignable → TEAM_NOT_INSTALLED ; avertissement agent-team selon CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', async () => {
  const sb = withRegistry([{ name: 'dev' }]);
  try {
    const nowhere = await sb.bytJson('info', 'ghost');
    assert.equal(nowhere.code, 1);
    assert.equal(nowhere.json.error.code, 'TEAM_NOT_INSTALLED');

    sb.env.BYT_REGISTRY = UNREACHABLE;
    const offline = await sb.bytJson('info', 'dev');
    assert.equal(offline.json.error.code, 'TEAM_NOT_INSTALLED');
    const offlineText = await sb.byt('info', 'dev');
    assert.match(offlineText.stderr, /« dev » n'est pas installée/);

    placeTeam(sb, { name: 'swarm', mode: 'agent-team', agents: ['lead', 'worker'] });
    const warned = await sb.byt('info', 'swarm');
    assert.equal(warned.code, 0);
    assert.match(warned.stdout, /Mode agent-team : la fonctionnalité expérimentale n'est pas activée/);
    assert.equal((await sb.bytJson('info', 'swarm')).json.data.agentTeamsEnabled, false);

    sb.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
    const enabled = await sb.byt('info', 'swarm');
    assert.doesNotMatch(enabled.stdout, /fonctionnalité expérimentale/);
    assert.equal((await sb.bytJson('info', 'swarm')).json.data.agentTeamsEnabled, true);

    sb.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '0';
    assert.match((await sb.byt('info', 'swarm')).stdout, /fonctionnalité expérimentale/, '« 0 » vaut désactivé');
  } finally {
    sb.cleanup();
  }
});

test('search : sans mot → USAGE, aucun résultat → message', async () => {
  const sb = withRegistry([{ name: 'dev', tags: ['web'] }]);
  try {
    const none = await sb.bytJson('search');
    assert.equal(none.json.error.code, 'USAGE');
    const blank = await sb.byt('search', '   ');
    assert.equal(blank.code, 1);
    assert.match(blank.stderr, /Usage : byt search <mot>/);

    const empty = await sb.bytJson('search', 'licorne');
    assert.equal(empty.json.ok, true);
    assert.deepEqual(empty.json.data.results, []);
    const text = await sb.byt('search', 'licorne');
    assert.equal(text.code, 0);
    assert.match(text.stdout, /Aucune team ne correspond à « licorne »/);
  } finally {
    sb.cleanup();
  }
});
