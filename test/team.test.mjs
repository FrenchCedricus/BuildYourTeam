import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTeam, compareVersions } from '../skill/lib/team.mjs';
import { buildRegistry } from '../scripts/build-registry.mjs';
import { sandbox, writeTeam, agentMd } from './helpers.mjs';

const manifestPath = (dir) => path.join(dir, 'team.json');
const readManifest = (dir) => JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
const writeManifest = (dir, m) => fs.writeFileSync(manifestPath(dir), JSON.stringify(m));

// Crée une team valide, applique `patch` au manifeste, puis valide.
function validateWith(patch, opts = {}) {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo', ...opts });
    const m = readManifest(dir);
    patch(m, dir);
    writeManifest(dir, m);
    return validateTeam(dir);
  } finally {
    sb.cleanup();
  }
}

// U05
test('validateTeam : manifeste absent', () => {
  const sb = sandbox();
  try {
    const dir = path.join(sb.dirs.registry, 'teams', 'vide');
    fs.mkdirSync(dir, { recursive: true });
    const r = validateTeam(dir);
    assert.equal(r.ok, false);
    assert.equal(r.team, null);
    assert.match(r.errors[0], /Aucun team\.json/);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam : JSON invalide', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    fs.writeFileSync(manifestPath(dir), '{ pas du json');
    const r = validateTeam(dir);
    assert.equal(r.ok, false);
    assert.equal(r.team, null);
    assert.match(r.errors[0], /JSON invalide/);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam : tableau ou null au lieu d\'objet', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    for (const content of ['[]', 'null']) {
      fs.writeFileSync(manifestPath(dir), content);
      const r = validateTeam(dir);
      assert.equal(r.ok, false, content);
      assert.deepEqual(r.errors, ['team.json doit contenir un objet JSON.'], content);
    }
  } finally {
    sb.cleanup();
  }
});

// U06 — un test par règle de validation.
const RULES = [
  ['version non semver', (m) => { m.version = '1.0'; }, /^version : « 1\.0 »/],
  ['description vide', (m) => { m.description = '   '; }, /^description : obligatoire/],
  ['tags non-chaînes', (m) => { m.tags = ['ok', 3]; }, /^tags : doit être une liste de chaînes/],
  ['mode inconnu', (m) => { m.mode = 'swarm'; }, /^mode : « swarm » invalide/],
  ['agents vide', (m) => { m.agents = []; }, /^agents : la team doit déclarer au moins un agent/],
  ['enabled non booléen', (m) => { m.agents[1].enabled = 'yes'; }, /agent « worker » : enabled doit valoir true ou false/],
  ['doublon', (m) => { m.agents.push({ name: 'worker', enabled: true }); }, /agent « worker » : déclaré deux fois/],
  ['nom ≠ dossier', (m) => { m.name = 'other'; }, /ne correspond pas au nom du dossier « demo »/],
];

for (const [label, patch, expected] of RULES) {
  test(`validateTeam : ${label}`, () => {
    const r = validateWith(patch);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => expected.test(e)), `attendu ${expected} dans :\n${r.errors.join('\n')}`);
  });
}

test('validateTeam : team de référence sans erreur ni avertissement', () => {
  const r = validateWith(() => {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

// U07
test('validateTeam : dossier .tmp- accepté quel que soit le nom', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    const tmp = path.join(path.dirname(dir), '.tmp-demo-abc123');
    fs.renameSync(dir, tmp);
    const r = validateTeam(tmp);
    assert.deepEqual(r.errors, []);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam : expectedName remplace le nom du dossier', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    const other = path.join(path.dirname(dir), 'autre-dossier');
    fs.renameSync(dir, other);
    assert.deepEqual(validateTeam(other, { expectedName: 'demo' }).errors, []);
    const r = validateTeam(other, { expectedName: 'zzz' });
    assert.ok(r.errors.some((e) => /ne correspond pas au nom du dossier « zzz »/.test(e)), r.errors.join('\n'));
  } finally {
    sb.cleanup();
  }
});

// U08
function warningsFor(workerMd, extra) {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    fs.writeFileSync(path.join(dir, 'agents', 'worker.md'), workerMd);
    if (extra) extra(dir);
    const r = validateTeam(dir);
    assert.deepEqual(r.errors, [], 'les avertissements ne sont pas des erreurs');
    return r.warnings;
  } finally {
    sb.cleanup();
  }
}

test('validateTeam : avertit pour un outil inconnu', () => {
  const w = warningsFor(agentMd({ name: 'worker', tools: 'Read, Foo' }));
  assert.deepEqual(w, ['agents/worker.md : outil inconnu « Foo ».']);
});

test('validateTeam : pas d\'avertissement pour mcp__*, Bash(git *) et claude-*', () => {
  const w = warningsFor(agentMd({ name: 'worker', tools: 'Read, mcp__x__y, Bash(git *)', model: 'claude-sonnet-4-5' }));
  assert.deepEqual(w, []);
});

test('validateTeam : avertit pour un modèle inhabituel', () => {
  const w = warningsFor(agentMd({ name: 'worker', model: 'gpt-4' }));
  assert.equal(w.length, 1);
  assert.match(w[0], /modèle « gpt-4 » inhabituel/);
});

test('validateTeam : avertit pour un prompt court', () => {
  const w = warningsFor(agentMd({ name: 'worker', body: 'Trop court.' }));
  assert.deepEqual(w, ['agents/worker.md : prompt système très court.']);
});

test('validateTeam : avertit pour un fichier non déclaré', () => {
  const w = warningsFor(agentMd({ name: 'worker' }), (dir) => {
    fs.writeFileSync(path.join(dir, 'agents', 'extra.md'), agentMd({ name: 'extra' }));
    fs.writeFileSync(path.join(dir, 'agents', 'notes.txt'), 'ignoré');
  });
  assert.deepEqual(w, ['agents/extra.md : fichier non déclaré dans team.json (ignoré).']);
});

// U09
test('compareVersions : majeur prioritaire', () => {
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.99.99', '2.0.0'), -1);
});

test('compareVersions : segments manquants valent 0', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1', '1.0.1'), -1);
});

test('compareVersions : une pré-release reste ordonnée par majeur/mineur/patch', () => {
  assert.equal(compareVersions('1.0.0-beta', '1.0.1'), -1);
  assert.equal(compareVersions('2.0.0-rc.1', '1.9.9'), 1);
});

// U21
test('buildRegistry : dossier absent → registry vide', () => {
  const sb = sandbox();
  try {
    const r = buildRegistry(path.join(sb.dirs.root, 'inexistant'));
    assert.deepEqual(r, { results: [], registry: { schema: 1, teams: [] } });
  } finally {
    sb.cleanup();
  }
});

test('buildRegistry : avertissement bloquant, fichiers ignorés, lead/agents/mode par défaut', () => {
  const sb = sandbox();
  try {
    const base = sb.dirs.registry;
    const teamsRoot = path.join(base, 'teams');
    // Team valide sans mode ni tags : valeurs par défaut.
    const ok = writeTeam(base, { name: 'alpha', agents: ['chef', 'worker'] });
    const m = readManifest(ok);
    delete m.mode;
    delete m.tags;
    writeManifest(ok, m);
    // Team avec un simple avertissement : exclue.
    const warn = writeTeam(base, { name: 'beta' });
    fs.writeFileSync(path.join(warn, 'agents', 'worker.md'), agentMd({ name: 'worker', tools: 'Read, Foo' }));
    // Fichier à la racine de teams/ : ignoré.
    fs.writeFileSync(path.join(teamsRoot, 'README.md'), 'pas une team');

    const { results, registry } = buildRegistry(teamsRoot);
    assert.deepEqual(results.map((r) => [r.name, r.ok]), [['alpha', true], ['beta', false]]);
    assert.deepEqual(results[1].errors, []);
    assert.equal(results[1].warnings.length, 1);
    assert.deepEqual(registry.teams, [
      {
        name: 'alpha',
        version: '1.0.0',
        description: 'Team de test alpha',
        author: 'tests',
        tags: [],
        mode: 'subagents',
        lead: 'chef',
        agents: ['chef', 'worker'],
        path: 'teams/alpha',
        files: ['team.json', 'agents/chef.md', 'agents/worker.md'],
      },
    ]);
  } finally {
    sb.cleanup();
  }
});
