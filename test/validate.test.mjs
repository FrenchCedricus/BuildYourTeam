import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, setFrontmatterField, renderFrontmatter } from '../skill/lib/frontmatter.mjs';
import { validateTeam, isValidName, compareVersions } from '../skill/lib/team.mjs';
import { buildRegistry } from '../scripts/build-registry.mjs';
import { sandbox, writeTeam } from './helpers.mjs';

test('frontmatter: parsing, quotes and CRLF', () => {
  const fm = parseFrontmatter('---\r\nname: a\r\ndescription: "Use it: always"\r\ntools: Read, Grep\r\n---\r\n\r\nBody');
  assert.deepEqual(fm.data, { name: 'a', description: 'Use it: always', tools: 'Read, Grep' });
  assert.equal(fm.body.trim(), 'Body');
  assert.equal(parseFrontmatter('no frontmatter'), null);
});

test('frontmatter: setFrontmatterField only changes the target key', () => {
  const src = '---\nname: backend\ndescription: Builds APIs\n---\n\nPrompt\n';
  const out = setFrontmatterField(src, 'name', 'byt-dev-backend');
  assert.equal(out, '---\nname: byt-dev-backend\ndescription: Builds APIs\n---\n\nPrompt\n');
});

test('frontmatter: renderFrontmatter quotes when needed', () => {
  const out = renderFrontmatter({ name: 'x', description: 'Role: test', tools: ['Read', 'Grep'] }, 'Hello');
  assert.equal(out, '---\nname: x\ndescription: "Role: test"\ntools: Read, Grep\n---\n\nHello\n');
  assert.equal(parseFrontmatter(out).data.tools, 'Read, Grep');
});

test('kebab-case names and version comparison', () => {
  assert.ok(isValidName('software-dev'));
  assert.ok(!isValidName('Software_Dev'));
  assert.ok(!isValidName('-dev'));
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('validateTeam: valid team', () => {
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

test('validateTeam: detects a missing lead, a missing frontmatter and invalid names', () => {
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
    assert.match(all, /lead: agent "boss" is not in the list/);
    assert.match(all, /worker\.md: missing frontmatter/);
    assert.match(all, /"Bad_Name": the name must be kebab-case/);
  } finally {
    sb.cleanup();
  }
});

test('validateTeam: an agent without tools is an error (it would inherit every tool)', () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'loose' });
    fs.writeFileSync(path.join(dir, 'agents', 'worker.md'), '---\nname: worker\ndescription: Does work\n---\n\nYou are a worker that does a lot of useful work.\n');
    const r = validateTeam(dir);
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), /"tools" field is required/);
  } finally {
    sb.cleanup();
  }
});

test('validate command on a folder', async () => {
  const sb = sandbox();
  try {
    const dir = writeTeam(sb.dirs.registry, { name: 'demo' });
    const ok = await sb.bytJson('validate', dir);
    assert.equal(ok.json.ok, true);
    fs.rmSync(path.join(dir, 'agents', 'worker.md'));
    const ko = await sb.byt('validate', dir);
    assert.equal(ko.code, 1);
    assert.match(ko.stdout, /worker\.md: file not found/);
    assert.match(ko.stderr, /Validation failed/);
  } finally {
    sb.cleanup();
  }
});

test('buildRegistry: only publishes teams without errors or warnings', () => {
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
