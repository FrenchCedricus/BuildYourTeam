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

// Copies the ACTIVE agents of the ACTIVE teams of a scope into .claude/agents,
// and removes BYT files that are no longer needed. Only byt-*.md files that
// BYT wrote itself (listed in state.synced) can be deleted or overwritten:
// the user's other agents are never touched.
//
// state.json and team.json are read back from disk and may come from a cloned repository:
// names, paths and content are checked again here before anything is written or deleted.
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
      warnings.push(`state.json: invalid team name "${teamName}", skipped.`);
      continue;
    }
    const dir = path.join(sp.teamsDir, teamName);
    if (!fs.existsSync(path.join(dir, 'team.json'))) {
      warnings.push(`Team "${teamName}": team.json not found, agents not synced.`);
      continue;
    }
    const v = validateTeam(dir, { expectedName: teamName });
    if (!v.ok) {
      warnings.push(`Team "${teamName}" is invalid, agents not synced: ${v.errors[0]}`);
      continue;
    }
    const team = v.team;
    for (const a of team.agents) {
      if (a.enabled === false) continue;
      const src = assertInside(dir, agentPath(dir, a.name));
      if (!fs.existsSync(src)) {
        warnings.push(`Team "${teamName}": agents/${a.name}.md not found.`);
        continue;
      }
      const file = agentFileName(teamName, a.name);
      if (desired.has(file)) {
        warnings.push(`Name conflict: ${file} is produced by two teams, only the first one is kept.`);
        continue;
      }
      // The frontmatter name must match the prefixed file name.
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
      warnings.push(`${file} already exists in ${sp.agentsDir} and was not created by BYT: file left untouched.`);
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
  if (result.written.length) parts.push(c.green(`${result.written.length} written`));
  if (result.removed.length) parts.push(c.yellow(`${result.removed.length} removed`));
  if (result.unchanged.length) parts.push(c.dim(`${result.unchanged.length} unchanged`));
  const lines = [`${c.dim('sync')} ${result.agentsDir}: ${parts.length ? parts.join(', ') : 'nothing to do'}`];
  for (const w of result.warnings) lines.push(`  ${c.yellow('warning')}  ${w}`);
  return lines.join('\n');
}
