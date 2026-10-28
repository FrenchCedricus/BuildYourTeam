import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseData, buildAgent } from '../skill/lib/builder.mjs';

const OPTS = { team: 'demo', goal: 'Tester' };
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code);

// U13
test('parseData : BOM retiré', () => {
  assert.deepEqual(parseData('﻿{"a":1}'), { a: 1 });
});

test('parseData : vide → {}', () => {
  assert.deepEqual(parseData(undefined), {});
  assert.deepEqual(parseData(null), {});
  assert.deepEqual(parseData(''), {});
  assert.deepEqual(parseData('  \n '), {});
});

test('parseData : tableau ou null JSON refusés', () => {
  throwsCode(() => parseData('[1, 2]'), 'INVALID_JSON');
  throwsCode(() => parseData('null'), 'INVALID_JSON');
});

test('parseData : JSON invalide → INVALID_JSON avec le libellé', () => {
  assert.throws(() => parseData('{', '--agent'), (e) => e.code === 'INVALID_JSON' && e.message.includes('--agent'));
});

test('parseData : objet renvoyé tel quel', () => {
  const obj = { name: 'x' };
  assert.equal(parseData(obj), obj);
});

// U14
test('buildAgent : modèle inconnu → INVALID_MODEL', () => {
  throwsCode(() => buildAgent({ name: 'worker', model: 'gpt-9' }, OPTS), 'INVALID_MODEL');
});

test('buildAgent : accès inconnu → INVALID_ACCESS', () => {
  throwsCode(() => buildAgent({ name: 'worker', access: 'root' }, OPTS), 'INVALID_ACCESS');
});

test('buildAgent : nom invalide → INVALID_NAME', () => {
  throwsCode(() => buildAgent({ name: 'Bad_Name' }, OPTS), 'INVALID_NAME');
  throwsCode(() => buildAgent(null, OPTS), 'INVALID_AGENT');
});

test('buildAgent : liste d\'outils vide → INVALID_TOOLS', () => {
  throwsCode(() => buildAgent({ name: 'worker', tools: [] }, OPTS), 'INVALID_TOOLS');
  throwsCode(() => buildAgent({ name: 'worker', tools: '' }, OPTS), 'INVALID_TOOLS');
});

test('buildAgent : tools en chaîne découpée', () => {
  const a = buildAgent({ name: 'worker', tools: 'Read, Bash(git *)' }, OPTS);
  assert.deepEqual(a.tools, ['Read', 'Bash(git *)']);
});

test('buildAgent : outils déduits de l\'accès par défaut', () => {
  const a = buildAgent({ name: 'worker', access: 'write' }, OPTS);
  assert.deepEqual(a.tools, ['Read', 'Grep', 'Glob', 'Edit', 'Write']);
});

test('buildAgent : enabled:false conservé, true par défaut', () => {
  assert.equal(buildAgent({ name: 'worker', enabled: false }, OPTS).enabled, false);
  assert.equal(buildAgent({ name: 'worker' }, OPTS).enabled, true);
});

test('buildAgent : rôle sans point final, description par défaut = rôle', () => {
  const a = buildAgent({ name: 'worker', role: '  Builds APIs.  ' }, OPTS);
  assert.equal(a.role, 'Builds APIs');
  assert.equal(a.description, 'Builds APIs');
});

test('buildAgent : generated vrai sans prompt, faux avec prompt fourni', () => {
  const gen = buildAgent({ name: 'worker' }, OPTS);
  assert.equal(gen.generated, true);
  assert.match(gen.prompt, /^You are the \*\*Worker\*\* of the "demo" team, whose goal is: Tester\./);
  const own = buildAgent({ name: 'worker', prompt: '  Mon prompt.  ' }, OPTS);
  assert.equal(own.generated, false);
  assert.equal(own.prompt, 'Mon prompt.');
});

test('buildAgent : valeurs par défaut du profil', () => {
  const a = buildAgent({ name: 'backend' }, OPTS);
  assert.deepEqual({ access: a.access, model: a.model }, { access: 'exec', model: 'sonnet' });
  assert.equal(buildAgent({ name: 'backend', model: 'rapide' }, OPTS).model, 'haiku');
});
