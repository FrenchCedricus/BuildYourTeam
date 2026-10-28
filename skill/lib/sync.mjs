import fs from 'node:fs';
import path from 'node:path';
import { scopePaths } from './context.mjs';
import { loadState, saveState } from './state.mjs';
import { agentPath, isValidName, validateTeam } from './team.mjs';
import { setFrontmatterField } from './frontmatter.mjs';
import { writeText, assertInside } from './fsutil.mjs';

export const PREFIX = 'byt-';

export function agentId(team, agent) {
  return `${PREFIX}${team}-${agent}`;
}

export function agentFileName(team, agent) {
  return `${agentId(team, agent)}.md`;
}

// Copie dans .claude/agents les agents ACTIFS des teams ACTIVES d'une portée,
// et retire les fichiers BYT devenus inutiles. Seuls les fichiers byt-*.md
// que BYT a lui-même écrits (listés dans state.synced) peuvent être supprimés
// ou écrasés : les autres agents de l'utilisateur ne sont jamais touchés.
//
// state.json et team.json sont relus sur le disque et peuvent venir d'un dépôt cloné :
// noms, chemins et contenu sont revérifiés ici avant toute écriture ou suppression.
export const SYNCED_FILE_RE = /^byt-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export function syncScope(ctx, scope) {
  const sp = scopePaths(ctx, scope);
  const state = loadState(sp);
  const synced0 = Array.isArray(state.synced) ? state.synced : [];
  const tracked = new Set(synced0.filter((f) => typeof f === 'string' && SYNCED_FILE_RE.test(f)));
  const desired = new Map();
  const warnings = [];

  for (const [teamName, info] of Object.entries(state.teams ?? {})) {
    if (info?.enabled === false) continue;
    if (!isValidName(teamName)) {
      warnings.push(`state.json : nom de team invalide « ${teamName} », ignoré.`);
      continue;
    }
    const dir = path.join(sp.teamsDir, teamName);
    if (!fs.existsSync(path.join(dir, 'team.json'))) {
      warnings.push(`Team « ${teamName} » : team.json introuvable, agents non synchronisés.`);
      continue;
    }
    const v = validateTeam(dir, { expectedName: teamName });
    if (!v.ok) {
      warnings.push(`Team « ${teamName} » invalide, agents non synchronisés : ${v.errors[0]}`);
      continue;
    }
    const team = v.team;
    for (const a of team.agents) {
      if (a.enabled === false) continue;
      const src = assertInside(dir, agentPath(dir, a.name));
      if (!fs.existsSync(src)) {
        warnings.push(`Team « ${teamName} » : agents/${a.name}.md introuvable.`);
        continue;
      }
      const file = agentFileName(teamName, a.name);
      if (desired.has(file)) {
        warnings.push(`Conflit de nom : ${file} est produit par deux teams, seul le premier est conservé.`);
        continue;
      }
      // Le nom dans le frontmatter doit correspondre au nom du fichier préfixé.
      const content = setFrontmatterField(fs.readFileSync(src, 'utf8'), 'name', agentId(teamName, a.name));
      desired.set(file, { content, team: teamName, agent: a.name });
    }
  }

  const written = [];
  const unchanged = [];
  const removed = [];
  const skipped = [];
  const synced = [];

  for (const [file, { content }] of desired) {
    const dest = assertInside(sp.agentsDir, path.join(sp.agentsDir, file));
    if (fs.existsSync(dest) && !tracked.has(file)) {
      skipped.push(file);
      warnings.push(`${file} existe déjà dans ${sp.agentsDir} sans avoir été créé par BYT : fichier laissé intact.`);
      continue;
    }
    synced.push(file);
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === content) {
      unchanged.push(file);
      continue;
    }
    writeText(dest, content);
    written.push(file);
  }

  for (const file of tracked) {
    if (synced.includes(file)) continue;
    const dest = assertInside(sp.agentsDir, path.join(sp.agentsDir, file));
    if (fs.lstatSync(dest, { throwIfNoEntry: false })?.isFile()) {
      fs.rmSync(dest);
      removed.push(file);
    }
  }

  state.synced = synced.sort();
  saveState(sp, state);
  return { scope, agentsDir: sp.agentsDir, active: synced, written, unchanged, removed, skipped, warnings };
}

export function formatSync(c, result) {
  const parts = [];
  if (result.written.length) parts.push(c.green(`${result.written.length} écrit(s)`));
  if (result.removed.length) parts.push(c.yellow(`${result.removed.length} retiré(s)`));
  if (result.unchanged.length) parts.push(c.dim(`${result.unchanged.length} inchangé(s)`));
  const lines = [`${c.dim('sync')} ${result.agentsDir} : ${parts.length ? parts.join(', ') : 'rien à faire'}`];
  for (const w of result.warnings) lines.push(`  ${c.yellow('attention')}  ${w}`);
  return lines.join('\n');
}
