import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildRegistry } from '../scripts/build-registry.mjs';
import { parseFrontmatter, splitTools } from '../skill/lib/frontmatter.mjs';
import { sandbox, REPO_ROOT, agentsIn } from './helpers.mjs';

// registry.json est régénéré par la GitHub Action après merge : on ne vérifie ici que la validité.
test('les teams du repo sont valides en mode strict', () => {
  const { results, registry } = buildRegistry(path.join(REPO_ROOT, 'teams'));
  for (const r of results) assert.ok(r.ok, `${r.name} :\n${[...r.errors, ...r.warnings].join('\n')}`);
  for (const name of ['brainstorming', 'game-dev', 'software-dev', 'testing']) {
    assert.ok(registry.teams.some((t) => t.name === name), `team de départ manquante : ${name}`);
  }
});

test('les agents en lecture seule n\'ont ni Edit, ni Write, ni Bash', () => {
  const readOnly = {
    'software-dev': ['architect', 'reviewer'],
    testing: ['test-planner'],
    brainstorming: ['visionary', 'critic', 'pragmatist', 'synthesizer'],
    'data-science': ['stats-reviewer'],
    devops: ['config-auditor'],
    'security-audit': ['threat-modeler', 'code-auditor', 'remediation-advisor'],
    documentation: ['doc-architect'],
    'legacy-modernization': ['migration-reviewer'],
    research: ['analyst'],
    'ux-design': ['ux-auditor'],
  };
  // Tous les leads coordonnent sans modifier ni exécuter quoi que ce soit.
  for (const team of fs.readdirSync(path.join(REPO_ROOT, 'teams'))) {
    const lead = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'teams', team, 'team.json'), 'utf8')).lead;
    readOnly[team] = [...new Set([...(readOnly[team] ?? []), lead])];
  }
  for (const [team, agents] of Object.entries(readOnly)) {
    for (const a of agents) {
      const fm = parseFrontmatter(fs.readFileSync(path.join(REPO_ROOT, 'teams', team, 'agents', `${a}.md`), 'utf8'));
      const tools = splitTools(fm.data.tools);
      for (const t of ['Edit', 'Write', 'Bash']) assert.ok(!tools.includes(t), `${team}/${a} ne doit pas avoir ${t}`);
    }
  }
});

test('installation de bout en bout depuis le registry du repo', async () => {
  const sb = sandbox();
  try {
    sb.env.BYT_REGISTRY = REPO_ROOT;
    const r = await sb.bytJson('install', 'software-dev');
    assert.equal(r.json.ok, true, r.stdout);
    assert.deepEqual(agentsIn(path.join(sb.dirs.claudeDir, 'agents')), [
      'byt-software-dev-architect.md',
      'byt-software-dev-backend.md',
      'byt-software-dev-docs.md',
      'byt-software-dev-frontend.md',
      'byt-software-dev-lead.md',
      'byt-software-dev-reviewer.md',
    ]);
    const info = await sb.bytJson('info', 'software-dev');
    assert.equal(info.json.data.lead, 'lead');
    assert.ok(info.json.data.leadFile.endsWith(path.join('software-dev', 'agents', 'lead.md')));
  } finally {
    sb.cleanup();
  }
});

test('SKILL.md : routeur réservé à l\'utilisateur, outils pré-autorisés limités', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'skill', 'SKILL.md'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'))[1];
  assert.match(fm, /^name: byt$/m);
  assert.match(fm, /^disable-model-invocation: true$/m);
  const allowed = fm.split('allowed-tools:')[1].trim().split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim());
  assert.deepEqual(allowed, [
    'Bash(node "${CLAUDE_SKILL_DIR}/byt.mjs" *)',
    'Bash(node ${CLAUDE_SKILL_DIR}/byt.mjs *)',
    'AskUserQuestion',
    'Read',
  ]);
  for (const cmd of ['run', 'new', 'add-agent']) assert.match(text, new RegExp(`## [0-9][.] \`${cmd}`));
});
