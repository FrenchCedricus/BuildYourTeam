import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../skill/lib/cli.mjs';
import { sandbox } from './helpers.mjs';

test('parseArgs : positionnels, booléens et options à valeur', () => {
  const a = parseArgs(['enable', 'software-dev', 'reviewer', '--project', '--data', '{"x":1}', '--from=game-dev']);
  assert.equal(a.command, 'enable');
  assert.deepEqual(a._, ['software-dev', 'reviewer']);
  assert.equal(a.flags.project, true);
  assert.equal(a.flags.data, '{"x":1}');
  assert.equal(a.flags.from, 'game-dev');
});

test('help est la commande par défaut', async () => {
  const sb = sandbox();
  try {
    const r = await sb.byt();
    assert.equal(r.code, 0);
    assert.match(r.stdout, /BuildYourTeam/);
    assert.match(r.stdout, /install <team>/);
  } finally {
    sb.cleanup();
  }
});

test('commande inconnue : erreur claire en français, code 1', async () => {
  const sb = sandbox();
  try {
    const r = await sb.byt('frobnicate');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Commande inconnue : « frobnicate »/);
    const j = await sb.bytJson('frobnicate');
    assert.equal(j.json.ok, false);
    assert.equal(j.json.error.code, 'UNKNOWN_COMMAND');
  } finally {
    sb.cleanup();
  }
});

test('list sans team installée', async () => {
  const sb = sandbox();
  try {
    const r = await sb.byt('list');
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Aucune team installée/);
    const j = await sb.bytJson('list');
    assert.deepEqual(j.json, { ok: true, command: 'list', data: { teams: [] } });
  } finally {
    sb.cleanup();
  }
});

test('config : lecture et écriture de l\'URL du registry', async () => {
  const sb = sandbox();
  try {
    delete sb.env.BYT_REGISTRY;
    const set = await sb.bytJson('config', 'registry', 'https://example.org/reg');
    assert.equal(set.json.data.config.registry, 'https://example.org/reg');
    const get = await sb.bytJson('config', 'registry');
    assert.equal(get.json.data.registry, 'https://example.org/reg');
    const bad = await sb.bytJson('config', 'nope', 'x');
    assert.equal(bad.json.error.code, 'UNKNOWN_CONFIG_KEY');
  } finally {
    sb.cleanup();
  }
});
