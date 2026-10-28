import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, placeTeam, agentsIn } from './helpers.mjs';
import { syncScope } from '../skill/lib/sync.mjs';
import { parseFrontmatter } from '../skill/lib/frontmatter.mjs';

const globalAgents = (sb) => path.join(sb.dirs.claudeDir, 'agents');
const projectAgents = (sb) => path.join(sb.dirs.project, '.claude', 'agents');

test('sync : conflit de nom entre teams (dev/api-lead vs dev-api/lead) → avertissement, premier conservé', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['api-lead'] });
    placeTeam(sb, { name: 'dev-api', agents: ['lead'] });
    const r = await sb.bytJson('sync', '--global');
    assert.equal(r.json.ok, true);
    const res = r.json.data.results[0];
    assert.deepEqual(res.written, ['byt-dev-api-lead.md']);
    assert.match(res.warnings.join('\n'), /Conflit de nom : byt-dev-api-lead\.md est produit par deux teams/);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-dev-api-lead.md']);
    const content = fs.readFileSync(path.join(globalAgents(sb), 'byt-dev-api-lead.md'), 'utf8');
    assert.equal(parseFrontmatter(content).data.description, 'Agent api-lead', 'le fichier vient de la première team (dev)');

    const text = await sb.byt('sync', '--global');
    assert.match(text.stdout, /attention\s+Conflit de nom/);
  } finally {
    sb.cleanup();
  }
});

test('sync : team.json manquant ou agent .md manquant → avertissement, la team est ignorée, le reste est synchronisé', () => {
  const sb = sandbox();
  try {
    const broken = placeTeam(sb, { name: 'broken', agents: ['lead'] });
    fs.rmSync(path.join(broken, 'team.json'));
    const partial = placeTeam(sb, { name: 'partial', agents: ['lead', 'gone'] });
    fs.rmSync(path.join(partial, 'agents', 'gone.md'));
    placeTeam(sb, { name: 'ok', agents: ['lead'] });

    const r = syncScope(sb.ctx(), 'global');
    const warnings = r.warnings.join('\n');
    assert.match(warnings, /Team « broken » : team\.json introuvable/);
    // Une team incomplète est revalidée et ignorée en entier.
    assert.match(warnings, /Team « partial » invalide, agents non synchronisés : agents\/gone\.md : fichier introuvable/);
    assert.deepEqual(agentsIn(globalAgents(sb)), ['byt-ok-lead.md']);
  } finally {
    sb.cleanup();
  }
});

test('sync : fichier BYT modifié à la main ou supprimé → réécrit', () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'dev', agents: ['lead', 'backend'] });
    syncScope(sb.ctx(), 'global');
    const lead = path.join(globalAgents(sb), 'byt-dev-lead.md');
    const backend = path.join(globalAgents(sb), 'byt-dev-backend.md');
    const original = fs.readFileSync(lead, 'utf8');

    fs.writeFileSync(lead, 'modifié à la main');
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

test('sync --project / --global ne traitent qu\'une portée', async () => {
  const sb = sandbox();
  try {
    placeTeam(sb, { name: 'glob', agents: ['lead'] });
    placeTeam(sb, { name: 'proj', scope: 'project', agents: ['lead'] });

    const p = await sb.bytJson('sync', '--project');
    assert.deepEqual(p.json.data.results.map((x) => x.scope), ['project']);
    assert.deepEqual(agentsIn(projectAgents(sb)), ['byt-proj-lead.md']);
    assert.deepEqual(agentsIn(globalAgents(sb)), [], 'la portée globale n\'est pas traitée');

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
