import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, placeTeam, agentsIn } from './helpers.mjs';
import { syncScope } from '../skill/lib/sync.mjs';
import { parseFrontmatter } from '../skill/lib/frontmatter.mjs';

const globalAgents = (sb) => path.join(sb.dirs.claudeDir, 'agents');

test('sync: copies the active agents with the byt-<team>-<agent> prefix', () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    const r = syncScope(sb.ctx(), 'global');
    assert.deepEqual(r.written, ['byt-dev-lead.md', 'byt-dev-backend.md']);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-backend.md', 'byt-dev-lead.md']);
    const fm = parseFrontmatter(fs.readFileSync(path.join(globalAgents(sb), 'byt-dev-backend.md'), 'utf8'));
    assert.equal(fm.data.name, 'byt-dev-backend', 'the frontmatter name is prefixed');
    const again = syncScope(sb.ctx(), 'global');
    assert.deepEqual(again.written, []);
    assert.equal(again.unchanged.length, 2);
  } finally {
    sb.cleanup();
  }
});

test('sync: never touches agents that do not come from BYT', () => {
  const sb = sandbox();
  try {
    const dir = globalAgents(sb);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'my-agent.md'), 'mine');
    // even a byt- prefixed file is left alone if BYT did not create it
    fs.writeFileSync(path.join(dir, 'byt-dev-lead.md'), 'written by hand');
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    const r = syncScope(sb.ctx(), 'global');
    assert.deepEqual(r.skipped, ['byt-dev-lead.md']);
    assert.match(r.warnings.join('\n'), /was not created by BYT/);
    assert.equal(fs.readFileSync(path.join(dir, 'byt-dev-lead.md'), 'utf8'), 'written by hand');
    assert.equal(fs.readFileSync(path.join(dir, 'my-agent.md'), 'utf8'), 'mine');

    fs.writeFileSync(path.join(sb.dirs.bytHome, 'state.json'), JSON.stringify({ teams: {}, synced: ['byt-dev-backend.md'] }));
    syncScope(sb.ctx(), 'global');
    assert.deepEqual(agentsIn(dir), ['byt-dev-lead.md', 'my-agent.md'], 'only the tracked file is removed');
  } finally {
    sb.cleanup();
  }
});

test('disable/enable an agent: removed, then copied again', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend', 'docs'] });
    await sb.byt('sync');
    const off = await sb.bytJson('disable', 'dev', 'docs');
    assert.equal(off.json.ok, true);
    assert.deepEqual(off.json.data.sync.removed, ['byt-dev-docs.md']);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-backend.md', 'byt-dev-lead.md']);
    const team = JSON.parse(fs.readFileSync(path.join(sb.dirs.bytHome, 'teams', 'dev', 'team.json'), 'utf8'));
    assert.equal(team.agents.find((a) => a.name === 'docs').enabled, false);

    const list = await sb.bytJson('list');
    assert.deepEqual(list.json.data.teams[0].agents.map((a) => a.enabled), [true, true, false]);

    await sb.byt('enable', 'dev', 'docs');
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-backend.md', 'byt-dev-docs.md', 'byt-dev-lead.md']);
  } finally {
    sb.cleanup();
  }
});

test('disable/enable a whole team', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    placeTeam(sb, { name: 'qa', agents: ['lead'] });
    await sb.byt('sync');
    const r = await sb.byt('disable', 'dev');
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Team dev disabled/);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-qa-lead.md']);
    const use = await sb.bytJson('use', 'dev');
    assert.deepEqual(use.json.data.agents.map((a) => a.subagent), ['byt-dev-lead', 'byt-dev-backend']);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-backend.md', 'byt-dev-lead.md', 'byt-qa-lead.md']);
  } finally {
    sb.cleanup();
  }
});

test('project scope: agents go to ./.claude/agents', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { scope: 'project', name: 'local-team', agents: ['lead'] });
    await sb.byt('sync');
    assert.deepEqual(agentsIn(path.join(sb.dirs.project, '.claude', 'agents')), ['byt-local-team-lead.md']);
    assert.deepEqual(agentsIn(globalAgents(sb)), []);
  } finally {
    sb.cleanup();
  }
});

test('clear errors: unknown team or agent', async () => {
  const sb = sandbox();
  try {
    const r = await sb.byt('enable', 'nope');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Team "nope" is not installed/);
    assert.match(r.stderr, /\/byt install nope/);
    placeTeam(sb, { name: 'dev' });
    const a = await sb.bytJson('disable', 'dev', 'ghost');
    assert.equal(a.json.error.code, 'AGENT_NOT_FOUND');
  } finally {
    sb.cleanup();
  }
});
