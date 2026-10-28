import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseData, buildAgent } from '../skill/lib/builder.mjs';

const OPTS = { team: 'demo', goal: 'Tester' };
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code);

// U13
test('parseData: BOM removed', () => {
  assert.deepEqual(parseData('﻿{"a":1}'), { a: 1 });
});

test('parseData: empty → {}', () => {
  assert.deepEqual(parseData(undefined), {});
  assert.deepEqual(parseData(null), {});
  assert.deepEqual(parseData(''), {});
  assert.deepEqual(parseData('  \n '), {});
});

test('parseData: JSON array or null refused', () => {
  throwsCode(() => parseData('[1, 2]'), 'INVALID_JSON');
  throwsCode(() => parseData('null'), 'INVALID_JSON');
});

test('parseData: invalid JSON → INVALID_JSON with the label', () => {
  assert.throws(() => parseData('{', '--agent'), (e) => e.code === 'INVALID_JSON' && e.message.includes('--agent'));
});

test('parseData: object returned as is', () => {
  const obj = { name: 'x' };
  assert.equal(parseData(obj), obj);
});

// U14
test('buildAgent: unknown model → INVALID_MODEL', () => {
  throwsCode(() => buildAgent({ name: 'worker', model: 'gpt-9' }, OPTS), 'INVALID_MODEL');
});

test('buildAgent: unknown access → INVALID_ACCESS', () => {
  throwsCode(() => buildAgent({ name: 'worker', access: 'root' }, OPTS), 'INVALID_ACCESS');
});

test('buildAgent: invalid name → INVALID_NAME', () => {
  throwsCode(() => buildAgent({ name: 'Bad_Name' }, OPTS), 'INVALID_NAME');
  throwsCode(() => buildAgent(null, OPTS), 'INVALID_AGENT');
});

test('buildAgent: empty tool list → INVALID_TOOLS', () => {
  throwsCode(() => buildAgent({ name: 'worker', tools: [] }, OPTS), 'INVALID_TOOLS');
  throwsCode(() => buildAgent({ name: 'worker', tools: '' }, OPTS), 'INVALID_TOOLS');
});

test('buildAgent: tools string is split', () => {
  const a = buildAgent({ name: 'worker', tools: 'Read, Bash(git *)' }, OPTS);
  assert.deepEqual(a.tools, ['Read', 'Bash(git *)']);
});

test('buildAgent: tools inferred from the default access', () => {
  const a = buildAgent({ name: 'worker', access: 'write' }, OPTS);
  assert.deepEqual(a.tools, ['Read', 'Grep', 'Glob', 'Edit', 'Write']);
});

test('buildAgent: enabled:false kept, true by default', () => {
  assert.equal(buildAgent({ name: 'worker', enabled: false }, OPTS).enabled, false);
  assert.equal(buildAgent({ name: 'worker' }, OPTS).enabled, true);
});

test('buildAgent: role without a final period, default description = role', () => {
  const a = buildAgent({ name: 'worker', role: '  Builds APIs.  ' }, OPTS);
  assert.equal(a.role, 'Builds APIs');
  assert.equal(a.description, 'Builds APIs');
});

test('buildAgent: generated is true without a prompt, false with a given prompt', () => {
  const gen = buildAgent({ name: 'worker' }, OPTS);
  assert.equal(gen.generated, true);
  assert.match(gen.prompt, /^You are the \*\*Worker\*\* of the "demo" team, whose goal is: Tester\./);
  const own = buildAgent({ name: 'worker', prompt: '  Mon prompt.  ' }, OPTS);
  assert.equal(own.generated, false);
  assert.equal(own.prompt, 'Mon prompt.');
});

test('buildAgent: profile defaults', () => {
  const a = buildAgent({ name: 'backend' }, OPTS);
  assert.deepEqual({ access: a.access, model: a.model }, { access: 'exec', model: 'sonnet' });
  assert.equal(buildAgent({ name: 'backend', model: 'fast' }, OPTS).model, 'haiku');
});
