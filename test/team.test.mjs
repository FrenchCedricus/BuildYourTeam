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

// Creates a valid team, applies `patch` to the manifest, then validates.
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
test('validateTeam: missing manifest', () => {
  const sb = sandbox();
  try {
    const dir = path.join(sb.dirs.registry, 'teams', 'vide');
    fs.mkdirSync(dir, { recursive: true });
    const r = validateTeam(dir);
    assert.equal(r.ok, false);
    assert.equal(r.team, null);
    assert.match(r.errors[0], /No team\.json/);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam: invalid JSON', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    fs.writeFileSync(manifestPath(dir), '{ not json');
    const r = validateTeam(dir);
    assert.equal(r.ok, false);
    assert.equal(r.team, null);
    assert.match(r.errors[0], /Invalid JSON/);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam: array or null instead of an object', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    for (const content of ['[]', 'null']) {
      fs.writeFileSync(manifestPath(dir), content);
      const r = validateTeam(dir);
      assert.equal(r.ok, false, content);
      assert.deepEqual(r.errors, ['team.json must contain a JSON object.'], content);
    }
  } finally {
    sb.cleanup();
  }
});

// U06 — one test per validation rule.
const RULES = [
  ['non-semver version', (m) => { m.version = '1.0'; }, /^version: "1\.0"/],
  ['empty description', (m) => { m.description = '   '; }, /^description: required/],
  ['non-string tags', (m) => { m.tags = ['ok', 3]; }, /^tags: must be a list of strings/],
  ['unknown mode', (m) => { m.mode = 'swarm'; }, /^mode: "swarm" is invalid/],
  ['empty agents', (m) => { m.agents = []; }, /^agents: the team must declare at least one agent/],
  ['non-boolean enabled', (m) => { m.agents[1].enabled = 'yes'; }, /agent "worker": enabled must be true or false/],
  ['duplicate', (m) => { m.agents.push({ name: 'worker', enabled: true }); }, /agent "worker": declared twice/],
  ['name ≠ folder', (m) => { m.name = 'other'; }, /does not match the folder name "demo"/],
];

for (const [label, patch, expected] of RULES) {
  test(`validateTeam: ${label}`, () => {
    const r = validateWith(patch);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => expected.test(e)), `expected ${expected} in:\n${r.errors.join('\n')}`);
  });
}

test('validateTeam: reference team without errors or warnings', () => {
  const r = validateWith(() => {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

// U07
test('validateTeam: .tmp- folder accepted whatever the name', () => {
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

test('validateTeam: expectedName replaces the folder name', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    const other = path.join(path.dirname(dir), 'other-folder');
    fs.renameSync(dir, other);
    assert.deepEqual(validateTeam(other, { expectedName: 'demo' }).errors, []);
    const r = validateTeam(other, { expectedName: 'zzz' });
    assert.ok(r.errors.some((e) => /does not match the folder name "zzz"/.test(e)), r.errors.join('\n'));
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
    assert.deepEqual(r.errors, [], 'warnings are not errors');
    return r.warnings;
  } finally {
    sb.cleanup();
  }
}

test('validateTeam: warns about an unknown tool', () => {
  const w = warningsFor(agentMd({ name: 'worker', tools: 'Read, Foo' }));
  assert.deepEqual(w, ['agents/worker.md: unknown tool "Foo".']);
});

test('validateTeam: no warning for mcp__*, Bash(git *) and claude-*', () => {
  const w = warningsFor(agentMd({ name: 'worker', tools: 'Read, mcp__x__y, Bash(git *)', model: 'claude-sonnet-4-5' }));
  assert.deepEqual(w, []);
});

test('validateTeam: warns about an unusual model', () => {
  const w = warningsFor(agentMd({ name: 'worker', model: 'gpt-4' }));
  assert.equal(w.length, 1);
  assert.match(w[0], /unusual model "gpt-4"/);
});

test('validateTeam: warns about a short prompt', () => {
  const w = warningsFor(agentMd({ name: 'worker', body: 'Too short.' }));
  assert.deepEqual(w, ['agents/worker.md: system prompt is very short.']);
});

test('validateTeam: warns about an undeclared file', () => {
  const w = warningsFor(agentMd({ name: 'worker' }), (dir) => {
    fs.writeFileSync(path.join(dir, 'agents', 'extra.md'), agentMd({ name: 'extra' }));
    fs.writeFileSync(path.join(dir, 'agents', 'notes.txt'), 'ignored');
  });
  assert.deepEqual(w, ['agents/extra.md: file not declared in team.json (ignored).']);
});

// U09
test('compareVersions: major version first', () => {
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.99.99', '2.0.0'), -1);
});

test('compareVersions: missing segments count as 0', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1', '1.0.1'), -1);
});

test('compareVersions: a pre-release is still ordered by major/minor/patch', () => {
  assert.equal(compareVersions('1.0.0-beta', '1.0.1'), -1);
  assert.equal(compareVersions('2.0.0-rc.1', '1.9.9'), 1);
});

// U21
test('buildRegistry: missing folder → empty registry', () => {
  const sb = sandbox();
  try {
    const r = buildRegistry(path.join(sb.dirs.root, 'inexistant'));
    assert.deepEqual(r, { results: [], registry: { schema: 1, teams: [] } });
  } finally {
    sb.cleanup();
  }
});

test('buildRegistry: blocking warning, ignored files, default lead/agents/mode', () => {
  const sb = sandbox();
  try {
    const base = sb.dirs.registry;
    const teamsRoot = path.join(base, 'teams');
    // Valid team without mode or tags: defaults.
    const ok = writeTeam(base, { name: 'alpha', agents: ['chef', 'worker'] });
    const m = readManifest(ok);
    delete m.mode;
    delete m.tags;
    writeManifest(ok, m);
    // Team with a single warning: excluded.
    const warn = writeTeam(base, { name: 'beta' });
    fs.writeFileSync(path.join(warn, 'agents', 'worker.md'), agentMd({ name: 'worker', tools: 'Read, Foo' }));
    // File at the root of teams/: ignored.
    fs.writeFileSync(path.join(teamsRoot, 'README.md'), 'not a team');

    const { results, registry } = buildRegistry(teamsRoot);
    assert.deepEqual(results.map((r) => [r.name, r.ok]), [['alpha', true], ['beta', false]]);
    assert.deepEqual(results[1].errors, []);
    assert.equal(results[1].warnings.length, 1);
    const { sha256: hashes, ...entry } = registry.teams[0];
    assert.deepEqual(Object.keys(hashes), ['team.json', 'agents/chef.md', 'agents/worker.md']);
    assert.ok(Object.values(hashes).every((h) => /^[0-9a-f]{64}$/.test(h)));
    assert.deepEqual([entry], [
      {
        name: 'alpha',
        version: '1.0.0',
        description: 'Test team alpha',
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
