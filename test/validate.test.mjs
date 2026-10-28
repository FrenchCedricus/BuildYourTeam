import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, setFrontmatterField, renderFrontmatter } from '../skill/lib/frontmatter.mjs';
import { validateTeam, isValidName, compareVersions } from '../skill/lib/team.mjs';
import { buildRegistry } from '../scripts/build-registry.mjs';
import { sandbox, writeTeam } from './helpers.mjs';

test('frontmatter : lecture, guillemets et CRLF', () => {
  const fm = parseFrontmatter('---\r\nname: a\r\ndescription: "Use it: always"\r\ntools: Read, Grep\r\n---\r\n\r\nBody');
  assert.deepEqual(fm.data, { name: 'a', description: 'Use it: always', tools: 'Read, Grep' });
  assert.equal(fm.body.trim(), 'Body');
  assert.equal(parseFrontmatter('pas de frontmatter'), null);
});

test('frontmatter : setFrontmatterField ne modifie que la clé visée', () => {
  const src = '---\nname: backend\ndescription: Builds APIs\n---\n\nPrompt\n';
  const out = setFrontmatterField(src, 'name', 'byt-dev-backend');
  assert.equal(out, '---\nname: byt-dev-backend\ndescription: Builds APIs\n---\n\nPrompt\n');
});

test('frontmatter : renderFrontmatter met entre guillemets si nécessaire', () => {
  const out = renderFrontmatter({ name: 'x', description: 'Role: test', tools: ['Read', 'Grep'] }, 'Hello');
  assert.equal(out, '---\nname: x\ndescription: "Role: test"\ntools: Read, Grep\n---\n\nHello\n');
  assert.equal(parseFrontmatter(out).data.tools, 'Read, Grep');
});

test('noms kebab-case et comparaison de versions', () => {
  assert.ok(isValidName('software-dev'));
  assert.ok(!isValidName('Software_Dev'));
  assert.ok(!isValidName('-dev'));
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('validateTeam : team valide', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    const r = validateTeam(dir);
    assert.deepEqual(r.errors, []);
    assert.ok(r.ok);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam : détecte lead absent, frontmatter manquant, noms invalides', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'broken', agents: ['lead', 'worker'] });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'team.json'), 'utf8'));
    manifest.lead = 'boss';
    manifest.agents.push({ name: 'Bad_Name' });
    fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, 'agents', 'worker.md'), 'Pas de frontmatter ici.');
    const r = validateTeam(dir);
    assert.equal(r.ok, false);
    const all = r.errors.join('\n');
    assert.match(all, /lead : l'agent « boss » n'existe pas/);
    assert.match(all, /worker\.md : frontmatter absent/);
    assert.match(all, /« Bad_Name » : le nom doit être en kebab-case/);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam : avertit si un agent n\'a pas de tools', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'loose' });
    fs.writeFileSync(path.join(dir, 'agents', 'worker.md'), '---\nname: worker\ndescription: Does work\n---\n\nYou are a worker that does a lot of useful work.\n');
    const r = validateTeam(dir);
    assert.ok(r.ok);
    assert.match(r.warnings.join('\n'), /pas de « tools »/);
  } finally {
    sb.cleanup();
  }
});

test('commande validate sur un dossier', async () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    const ok = await sb.bytJson('validate', dir);
    assert.equal(ok.json.ok, true);
    fs.rmSync(path.join(dir, 'agents', 'worker.md'));
    const ko = await sb.byt('validate', dir);
    assert.equal(ko.code, 1);
    assert.match(ko.stdout, /worker\.md : fichier introuvable/);
    assert.match(ko.stderr, /Validation échouée/);
  } finally {
    sb.cleanup();
  }
});

test('buildRegistry : ne publie que les teams sans erreur ni avertissement', () => {
  const sb = sandbox();
  try {
    writeTeam(sb.dirs.registry, { name: 'good', agents: ['lead', 'helper'] });
    const bad = writeTeam(sb.dirs.registry, { name: 'bad' });
    fs.rmSync(path.join(bad, 'agents', 'lead.md'));
    const { results, registry } = buildRegistry(path.join(sb.dirs.registry, 'teams'));
    assert.deepEqual(registry.teams.map((t) => t.name), ['good']);
    assert.deepEqual(registry.teams[0].files, ['team.json', 'agents/lead.md', 'agents/helper.md']);
    assert.equal(results.find((r) => r.name === 'bad').ok, false);
  } finally {
    sb.cleanup();
  }
});
