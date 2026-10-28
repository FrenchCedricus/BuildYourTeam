import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccess, normalizeModel, defaultsFor, profileFor, templatePrompt, isLeadName } from '../skill/lib/roles.mjs';

// U10
test('normalizeAccess : alias, accents, casse et espaces', () => {
  assert.equal(normalizeAccess('Lecture seule'), 'read');
  assert.equal(normalizeAccess('read-only'), 'read');
  assert.equal(normalizeAccess('Écriture'), 'write');
  assert.equal(normalizeAccess('  BASH '), 'exec');
  assert.equal(normalizeAccess('Exécution'), 'exec');
});

test('normalizeAccess : inconnu ou vide → null', () => {
  assert.equal(normalizeAccess('root'), null);
  assert.equal(normalizeAccess(''), null);
  assert.equal(normalizeAccess(undefined), null);
});

test('normalizeModel : alias et accents', () => {
  assert.equal(normalizeModel('Rapide'), 'haiku');
  assert.equal(normalizeModel('Équilibré'), 'sonnet');
  assert.equal(normalizeModel('PUISSANT'), 'opus');
  assert.equal(normalizeModel('inherit'), 'inherit');
});

test('normalizeModel : identifiant claude-* conservé en minuscules', () => {
  assert.equal(normalizeModel('Claude-Opus-4-1'), 'claude-opus-4-1');
});

test('normalizeModel : inconnu ou vide → null', () => {
  assert.equal(normalizeModel('gpt-4'), null);
  assert.equal(normalizeModel(''), null);
  assert.equal(normalizeModel(null), null);
});

// U11
test('defaultsFor : lead par nom ou par option isLead', () => {
  const lead = defaultsFor('lead');
  assert.deepEqual({ access: lead.access, model: lead.model }, { access: 'read', model: 'opus' });
  assert.match(lead.role, /^Coordinates the team/);
  assert.deepEqual(defaultsFor('backend', { isLead: true }), lead);
});

test('defaultsFor : builder → accès écriture', () => {
  assert.deepEqual(defaultsFor('builder'), { role: 'Produces the main deliverable of the task', access: 'write', model: 'sonnet' });
});

test('defaultsFor : nom inconnu → spécialiste en lecture seule', () => {
  assert.deepEqual(defaultsFor('quantum-wizard'), { role: 'Quantum Wizard specialist', access: 'read', model: 'sonnet' });
});

test('defaultsFor : profil reconnu', () => {
  assert.deepEqual(defaultsFor('backend'), { role: 'Implements server-side logic, APIs and data access', access: 'exec', model: 'sonnet' });
});

test('profileFor : le premier profil de la liste l\'emporte', () => {
  assert.match(profileFor('api-reviewer').role, /server-side/, 'backend avant review');
  assert.match(profileFor('security-reviewer').role, /^Reviews work/, 'review avant security');
  assert.match(profileFor('qa-docs').role, /^Verifies behaviour/, 'test avant doc');
  assert.equal(profileFor('zorglub'), null);
});

test('isLeadName : lead seulement en début de nom', () => {
  assert.equal(isLeadName('chef-projet'), true);
  assert.equal(isLeadName('leader'), true);
  assert.equal(isLeadName('test-lead'), false);
});

// U12
test('templatePrompt : lead sans coéquipiers', () => {
  const p = templatePrompt({ name: 'lead', role: 'Coordinates', access: 'read', team: 'demo', isLead: true });
  assert.match(p, /## Your team\n- \(no teammates yet\)\n/);
  assert.match(p, /^You are the \*\*Lead\*\* of the "demo" team\./);
});

test('templatePrompt : lead liste ses coéquipiers', () => {
  const p = templatePrompt({ name: 'lead', role: 'R', access: 'read', team: 'demo', isLead: true, teammates: [{ name: 'backend', role: 'Builds API' }] });
  assert.match(p, /## Your team\n- \*\*backend\*\*: Builds API\n/);
  assert.doesNotMatch(p, /no teammates yet/);
});

test('templatePrompt : point final de l\'objectif retiré', () => {
  const p = templatePrompt({ name: 'backend', role: 'R', access: 'exec', team: 'shop', goal: 'Ship the shop.' });
  assert.ok(p.startsWith('You are the **Backend** of the "shop" team, whose goal is: Ship the shop.\n'), p.split('\n')[0]);
});

test('templatePrompt : accès inconnu → règles lecture seule', () => {
  const p = templatePrompt({ name: 'worker', role: 'R', access: 'zzz', team: 't' });
  assert.match(p, /You are \*\*read-only\*\*/);
  assert.doesNotMatch(p, /Bash/);
});

test('templatePrompt : agent sans profil → responsabilités génériques', () => {
  const p = templatePrompt({ name: 'zorglub', role: 'R', access: 'write', team: 't' });
  assert.match(p, /Understand exactly what the lead asks of you/);
  assert.match(p, /You may create and edit files/);
});
