import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, placeTeam, writeTeam, writeRegistry } from './helpers.mjs';
import { compareVersions } from '../skill/lib/team.mjs';
import { buildAgent, parseData } from '../skill/lib/builder.mjs';
import { parseArgs } from '../skill/lib/cli.mjs';

// Bugs found by the testing and documentation teams.

test('compareVersions: a pre-release sorts before the final version', () => {
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta'), 1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-beta.1'), -1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-rc.1'), 0);
});

test('update: an installed beta version is updated to the final version', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', version: '1.0.0-beta' });
    writeTeam(sb.dirs.registry, { name: 'dev', version: '1.0.0' });
    writeRegistry(sb.dirs.registry);
    const r = await sb.bytJson('update', 'dev');
    assert.equal(r.json.data.results[0].status, 'updated');
    assert.equal(r.json.data.results[0].version, '1.0.0');
  } finally {
    sb.cleanup();
  }
});

test('help <command>: only that command\'s lines; unknown command → full help', async () => {
  const sb = sandbox();
  try {
    const list = await sb.bytJson('help', 'list');
    assert.deepEqual(list.json.data.commands.map((c) => c.usage), ['list', 'list --available']);
    const text = await sb.byt('install', '--help');
    assert.match(text.stdout, /help for "install"/);
    assert.doesNotMatch(text.stdout, /uninstall/);
    const full = await sb.bytJson('help', 'nope');
    assert.ok(full.json.data.commands.length > 10);
  } finally {
    sb.cleanup();
  }
});

test('interrupted add-agent: the hint suggests byt add-agent --data, not byt new', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev' });
    const r = await sb.byt('add-agent', 'dev', { stdin: '' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /add-agent <team> --data/);
    assert.doesNotMatch(r.stderr, /byt new --data/);
  } finally {
    sb.cleanup();
  }
});

test('buildAgent: a whitespace-only prompt is generated (generated: true)', () => {
  const a = buildAgent({ name: 'worker', prompt: '   \n ' }, { team: 't', goal: 'g' });
  assert.equal(a.generated, true);
  assert.ok(a.prompt.length > 40);
});

test('parseData: an array passed directly is refused, as in JSON text', () => {
  assert.throws(() => parseData([1, 2]), (e) => e.code === 'INVALID_JSON');
  assert.throws(() => parseData('[1, 2]'), (e) => e.code === 'INVALID_JSON');
  assert.deepEqual(parseData({ a: 1 }), { a: 1 });
});

test('cli: --all is no longer a boolean option', () => {
  assert.equal(parseArgs(['list', '--json']).flags.json, true);
  assert.equal(parseArgs(['list', '--all', 'x']).flags.all, 'x');
});
