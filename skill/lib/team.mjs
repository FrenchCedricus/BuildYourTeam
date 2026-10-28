import fs from 'node:fs';
import path from 'node:path';
import { BytError, errors } from './errors.mjs';
import { readJson, writeJson } from './fsutil.mjs';
import { parseFrontmatter, splitTools } from './frontmatter.mjs';

export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const MODES = ['subagents', 'agent-team'];
export const MODELS = ['haiku', 'sonnet', 'opus', 'inherit'];
export const KNOWN_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
  'NotebookEdit', 'TodoWrite', 'Agent', 'Task', 'Skill', 'LSP', 'AskUserQuestion',
];

// Only these keys are accepted in an agent's frontmatter: a registry team must not be able
// to declare permissionMode, hooks, mcpServers or other settings that widen its rights.
export const ALLOWED_FRONTMATTER_KEYS = ['name', 'description', 'tools', 'model', 'color'];
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'];

export function isValidName(name) {
  return typeof name === 'string' && name.length <= 64 && NAME_RE.test(name);
}

export function assertName(kind, name) {
  if (!isValidName(name)) throw errors.invalidName(kind, name ?? '');
  return name;
}

export function agentPath(teamDir, agent) {
  return path.join(teamDir, 'agents', `${agent}.md`);
}

export function loadTeam(dir) {
  const manifest = path.join(dir, 'team.json');
  if (!fs.existsSync(manifest)) {
    throw new BytError('TEAM_MANIFEST_MISSING', `No team.json in ${dir}.`, 'A team must contain team.json and an agents/ folder.');
  }
  return readJson(manifest);
}

// Stable key order for clean diffs.
export function saveTeam(dir, team) {
  const { name, version, description, author, tags, lead, mode, agents, ...rest } = team;
  writeJson(path.join(dir, 'team.json'), { name, version, description, author, tags, lead, mode, ...rest, agents });
}

export function readAgent(teamDir, agent) {
  const file = agentPath(teamDir, agent);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  return { file, text, frontmatter: fm?.data ?? null, duplicates: fm?.duplicates ?? [], body: fm?.body ?? text };
}

// Validates a whole team. Never throws: returns the list of problems found.
export function validateTeam(dir, { expectedName } = {}) {
  const errors = [];
  const warnings = [];
  let team;
  try {
    team = loadTeam(dir);
  } catch (e) {
    return { ok: false, errors: [e.message], warnings, team: null };
  }

  if (typeof team !== 'object' || team === null || Array.isArray(team)) {
    return { ok: false, errors: ['team.json must contain a JSON object.'], warnings, team: null };
  }

  const name = team.name;
  if (!isValidName(name)) errors.push(`name: "${name ?? ''}" must be kebab-case (e.g. "software-dev").`);
  const folder = expectedName ?? path.basename(dir);
  if (isValidName(name) && !folder.startsWith('.tmp-') && name !== folder) {
    errors.push(`name: "${name}" does not match the folder name "${folder}".`);
  }
  if (typeof team.version !== 'string' || !SEMVER_RE.test(team.version)) {
    errors.push(`version: "${team.version ?? ''}" must follow semver (e.g. "1.0.0").`);
  }
  if (typeof team.description !== 'string' || !team.description.trim()) errors.push('description: required.');
  if (team.author !== undefined && typeof team.author !== 'string') errors.push('author: must be a string.');
  if (!team.author) warnings.push('author: missing.');
  if (team.tags !== undefined && (!Array.isArray(team.tags) || team.tags.some((t) => typeof t !== 'string'))) {
    errors.push('tags: must be a list of strings.');
  }
  const mode = team.mode ?? 'subagents';
  if (!MODES.includes(mode)) errors.push(`mode: "${mode}" is invalid (expected: ${MODES.join(' or ')}).`);

  const agents = Array.isArray(team.agents) ? team.agents : null;
  if (!agents || agents.length === 0) {
    errors.push('agents: the team must declare at least one agent.');
  } else {
    const seen = new Set();
    for (const [i, a] of agents.entries()) {
      const label = a?.name ?? `#${i + 1}`;
      if (!a || typeof a !== 'object') {
        errors.push(`agents[${i}]: must be an object { "name", "enabled" }.`);
        continue;
      }
      if (!isValidName(a.name)) {
        errors.push(`agent "${label}": the name must be kebab-case.`);
        continue;
      }
      if (seen.has(a.name)) errors.push(`agent "${a.name}": declared twice.`);
      seen.add(a.name);
      if (a.enabled !== undefined && typeof a.enabled !== 'boolean') errors.push(`agent "${a.name}": enabled must be true or false.`);
      validateAgentFile(dir, a.name, errors, warnings);
    }
    if (!team.lead) errors.push('lead: required (name of the agent that coordinates the team).');
    else if (!seen.has(team.lead)) errors.push(`lead: agent "${team.lead}" is not in the list of agents.`);
    else {
      // The lead coordinates: if it can edit or run commands, it is almost always a design mistake.
      const leadTools = splitTools(readAgent(dir, team.lead)?.frontmatter?.tools).map((t) => t.replace(/\(.*\)$/, ''));
      const risky = leadTools.filter((t) => WRITE_TOOLS.includes(t));
      if (risky.length) warnings.push(`lead "${team.lead}": can edit files or run commands (${risky.join(', ')}); a lead should stay read-only.`);
    }

    const agentsDir = path.join(dir, 'agents');
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (f.endsWith('.md') && !seen.has(f.slice(0, -3))) warnings.push(`agents/${f}: file not declared in team.json (ignored).`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, team };
}

function validateAgentFile(dir, name, errors, warnings) {
  const agent = readAgent(dir, name);
  const rel = `agents/${name}.md`;
  if (!agent) {
    errors.push(`${rel}: file not found.`);
    return;
  }
  if (!agent.frontmatter) {
    errors.push(`${rel}: missing frontmatter (a --- block at the top of the file with name, description, tools, model).`);
    return;
  }
  const fm = agent.frontmatter;
  for (const key of Object.keys(fm)) {
    if (!ALLOWED_FRONTMATTER_KEYS.includes(key)) {
      errors.push(`${rel}: key "${key}" is not allowed in the frontmatter (allowed: ${ALLOWED_FRONTMATTER_KEYS.join(', ')}).`);
    }
  }
  for (const key of new Set(agent.duplicates)) errors.push(`${rel}: key "${key}" is declared more than once.`);
  if (!fm.name) errors.push(`${rel}: the "name" field is required.`);
  else if (fm.name !== name) errors.push(`${rel}: name "${fm.name}" differs from the file name "${name}".`);
  if (!fm.description) errors.push(`${rel}: the "description" field is required.`);
  if (!fm.tools) {
    errors.push(`${rel}: the "tools" field is required (without it, the agent would inherit every tool).`);
  } else {
    for (const tool of splitTools(fm.tools)) {
      const base = tool.replace(/\(.*\)$/, '');
      if (!KNOWN_TOOLS.includes(base) && !base.startsWith('mcp__')) warnings.push(`${rel}: unknown tool "${tool}".`);
    }
  }
  if (fm.model && !MODELS.includes(fm.model) && !fm.model.startsWith('claude-')) {
    warnings.push(`${rel}: unusual model "${fm.model}" (expected: ${MODELS.join(', ')}).`);
  }
  if (agent.body.trim().length < 40) warnings.push(`${rel}: system prompt is very short.`);
}

// Semver comparison: major.minor.patch, then a pre-release (1.0.0-beta) sorts before the final version.
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, ...pre] = String(v).split('-');
    return { core: core.split('.').map((x) => parseInt(x, 10) || 0), pre: pre.length ? pre.join('-').split('.') : [] };
  };
  const va = split(a);
  const vb = split(b);
  for (let i = 0; i < 3; i++) {
    if ((va.core[i] ?? 0) !== (vb.core[i] ?? 0)) return (va.core[i] ?? 0) > (vb.core[i] ?? 0) ? 1 : -1;
  }
  if (!va.pre.length || !vb.pre.length) return va.pre.length === vb.pre.length ? 0 : va.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function teamFiles(team) {
  return ['team.json', ...team.agents.map((a) => `agents/${a.name}.md`)];
}
