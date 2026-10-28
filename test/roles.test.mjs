import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccess, normalizeModel, defaultsFor, profileFor, templatePrompt, isLeadName } from '../skill/lib/roles.mjs';

// U10
test('normalizeAccess: aliases, case and spaces', () => {
  assert.equal(normalizeAccess('Read-only'), 'read');
  assert.equal(normalizeAccess('read only'), 'read');
  assert.equal(normalizeAccess('Edit files'), 'write');
  assert.equal(normalizeAccess('  BASH '), 'exec');
  assert.equal(normalizeAccess('Run commands'), 'exec');
});

test('normalizeAccess: unknown or empty → null', () => {
  assert.equal(normalizeAccess('root'), null);
  assert.equal(normalizeAccess(''), null);
  assert.equal(normalizeAccess(undefined), null);
});

test('normalizeModel: aliases and case', () => {
  assert.equal(normalizeModel('Fast'), 'haiku');
  assert.equal(normalizeModel('Balanced'), 'sonnet');
  assert.equal(normalizeModel('POWERFUL'), 'opus');
  assert.equal(normalizeModel('inherit'), 'inherit');
});

test('normalizeModel: claude-* id kept in lowercase', () => {
  assert.equal(normalizeModel('Claude-Opus-4-1'), 'claude-opus-4-1');
});

test('normalizeModel: unknown or empty → null', () => {
  assert.equal(normalizeModel('gpt-4'), null);
  assert.equal(normalizeModel(''), null);
  assert.equal(normalizeModel(null), null);
});

// U11
test('defaultsFor: lead by name or by the isLead option', () => {
  const lead = defaultsFor('lead');
  assert.deepEqual({ access: lead.access, model: lead.model }, { access: 'read', model: 'opus' });
  assert.match(lead.role, /^Coordinates the team/);
  assert.deepEqual(defaultsFor('backend', { isLead: true }), lead);
});

test('defaultsFor: builder → write access', () => {
  assert.deepEqual(defaultsFor('builder'), { role: 'Produces the main deliverable of the task', access: 'write', model: 'sonnet' });
});

test('defaultsFor: unknown name → read-only specialist', () => {
  assert.deepEqual(defaultsFor('quantum-wizard'), { role: 'Quantum Wizard specialist', access: 'read', model: 'sonnet' });
});

test('defaultsFor: known profile', () => {
  assert.deepEqual(defaultsFor('backend'), { role: 'Implements server-side logic, APIs and data access', access: 'exec', model: 'sonnet' });
});

test('profileFor: the first profile in the list wins', () => {
  assert.match(profileFor('api-reviewer').role, /server-side/, 'backend avant review');
  assert.match(profileFor('security-reviewer').role, /^Reviews work/, 'review avant security');
  assert.match(profileFor('qa-docs').role, /^Verifies behaviour/, 'test avant doc');
  assert.equal(profileFor('zorglub'), null);
});

test('isLeadName: lead only at the start of the name', () => {
  assert.equal(isLeadName('chef-project'), true);
  assert.equal(isLeadName('leader'), true);
  assert.equal(isLeadName('test-lead'), false);
});

// U12
test('templatePrompt: lead without teammates', () => {
  const p = templatePrompt({ name: 'lead', role: 'Coordinates', access: 'read', team: 'demo', isLead: true });
  assert.match(p, /## Your team\n- \(no teammates yet\)\n/);
  assert.match(p, /^You are the \*\*Lead\*\* of the "demo" team\./);
});

test('templatePrompt: lead lists its teammates', () => {
  const p = templatePrompt({ name: 'lead', role: 'R', access: 'read', team: 'demo', isLead: true, teammates: [{ name: 'backend', role: 'Builds API' }] });
  assert.match(p, /## Your team\n- \*\*backend\*\*: Builds API\n/);
  assert.doesNotMatch(p, /no teammates yet/);
});

test('templatePrompt: final period of the goal removed', () => {
  const p = templatePrompt({ name: 'backend', role: 'R', access: 'exec', team: 'shop', goal: 'Ship the shop.' });
  assert.ok(p.startsWith('You are the **Backend** of the "shop" team, whose goal is: Ship the shop.\n'), p.split('\n')[0]);
});

test('templatePrompt: unknown access → read-only rules', () => {
  const p = templatePrompt({ name: 'worker', role: 'R', access: 'zzz', team: 't' });
  assert.match(p, /You are \*\*read-only\*\*/);
  assert.doesNotMatch(p, /Bash/);
});

test('templatePrompt: agent without a profile → generic responsibilities', () => {
  const p = templatePrompt({ name: 'zorglub', role: 'R', access: 'write', team: 't' });
  assert.match(p, /Understand exactly what the lead asks of you/);
  assert.match(p, /You may create and edit files/);
});
