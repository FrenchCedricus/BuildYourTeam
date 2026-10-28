import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, placeTeam, agentsIn } from './helpers.mjs';
import { syncScope } from '../skill/lib/sync.mjs';
import { parseFrontmatter } from '../skill/lib/frontmatter.mjs';

const globalAgents = (sb) => path.join(sb.dirs.claudeDir, 'agents');
const projectAgents = (sb) => path.join(sb.dirs.project, '.claude', 'agents');

test('sync: name conflict between teams (dev/api-lead vs dev-api/lead) → warning, first one kept', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['api-lead'] });
    placeTeam(sb, { name: 'dev-api', agents: ['lead'] });
    const r = await sb.bytJson('sync', '--global');
    assert.equal(r.json.ok, true);
    const res = r.json.data.results[0];
    assert.deepEqual(res.written, ['byt-dev-api-lead.md']);
    assert.match(res.warnings.join('\n'), /Name conflict: byt-dev-api-lead\.md is produced by two teams/);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-api-lead.md']);
    const content = fs.readFileSync(path.join(globalAgents(sb), 'byt-dev-api-lead.md'), 'utf8');
    assert.equal(parseFrontmatter(content).data.description, 'Agent api-lead', 'the file comes from the first team (dev)');

    const text = await sb.byt('sync', '--global');
    assert.match(text.stdout, /warning\s+Name conflict/);
  } finally {
    sb.cleanup();
  }
});

test('sync: missing team.json or agent .md → warning, the team is skipped, the rest is synced', () => {
  const sb = sandbox();
  try {
    const broken = placeTeam(sb, { name: 'broken', agents: ['lead'] });
    fs.rmSync(path.join(broken, 'team.json'));
    const partial = placeTeam(sb, { name: 'partial', agents: ['lead', 'gone'] });
    fs.rmSync(path.join(partial, 'agents', 'gone.md'));
    placeTeam(sb, { name: 'ok', agents: ['lead'] });

    const r = syncScope(sb.ctx(), 'global');
    const warnings = r.warnings.join('\n');
    assert.match(warnings, /Team "broken": team\.json not found/);
    // An incomplete team is validated again and skipped entirely.
    assert.match(warnings, /Team "partial" is invalid, agents not synced: agents\/gone\.md: file not found/);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-ok-lead.md']);
  } finally {
    sb.cleanup();
  }
});

test('sync: BYT file edited by hand or deleted → written again', () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    syncScope(sb.ctx(), 'global');
    const lead = path.join(globalAgents(sb), 'byt-dev-lead.md');
    const backend = path.join(globalAgents(sb), 'byt-dev-backend.md');
    const original = fs.readFileSync(lead, 'utf8');

    fs.writeFileSync(lead, 'edited by hand');
    fs.rmSync(backend);
    const r = syncScope(sb.ctx(), 'global');
    assert.deepEqual(r.written.sort(), ['byt-dev-backend.md', 'byt-dev-lead.md']);
    assert.deepEqual(r.skipped, []);
    assert.equal(fs.readFileSync(lead, 'utf8'), original);
    assert.ok(fs.existsSync(backend));
    assert.equal(parseFrontmatter(fs.readFileSync(backend, 'utf8')).data.name, 'byt-dev-backend');
  } finally {
    sb.cleanup();
  }
});

test('sync --project / --global only handle one scope', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'glob', agents: ['lead'] });
    placeTeam(sb, { name: 'proj', scope: 'project', agents: ['lead'] });

    const p = await sb.bytJson('sync', '--project');
    assert.deepEqual(p.json.data.results.map((x) => x.scope), ['project']);
    assert.deepEqual(agentsIn(projectAgents(sb)), ['byt-proj-lead.md']);
    assert.deepEqual(agentsIn(globalAgents(sb)), [], 'the global scope is not handled');

    const g = await sb.bytJson('sync', '--global');
    assert.deepEqual(g.json.data.results.map((x) => x.scope), ['global']);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-glob-lead.md']);
    assert.deepEqual(g.json.data.results[0].written, ['byt-glob-lead.md']);

    const both = await sb.bytJson('sync', '--project', '--global');
    assert.equal(both.json.error.code, 'CONFLICTING_SCOPES');

    const all = await sb.bytJson('sync');
    assert.deepEqual(all.json.data.results.map((x) => x.scope), ['project', 'global']);
  } finally {
    sb.cleanup();
  }
});
