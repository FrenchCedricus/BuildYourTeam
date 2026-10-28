import fs from 'node:fs';
import path from 'node:path';
import { BytError } from './errors.mjs';
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

export function isValidName(name) {
  return typeof name === 'string' && name.length <= 64 && NAME_RE.test(name);
}

export function agentPath(teamDir, agent) {
  return path.join(teamDir, 'agents', `${agent}.md`);
}

export function loadTeam(dir) {
  const manifest = path.join(dir, 'team.json');
  if (!fs.existsSync(manifest)) {
    throw new BytError('TEAM_MANIFEST_MISSING', `Aucun team.json dans ${dir}.`, 'Une team doit contenir team.json et un dossier agents/.');
  }
  return readJson(manifest);
}

// Ordre des clés stable pour des diffs propres.
export function saveTeam(dir, team) {
  const { name, version, description, author, tags, lead, mode, agents, ...rest } = team;
  writeJson(path.join(dir, 'team.json'), { name, version, description, author, tags, lead, mode, ...rest, agents });
}

export function readAgent(teamDir, agent) {
  const file = agentPath(teamDir, agent);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  return { file, text, frontmatter: fm?.data ?? null, body: fm?.body ?? text };
}

// Valide une team complète. Ne lève pas d'erreur : renvoie la liste des problèmes trouvés.
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
    return { ok: false, errors: ['team.json doit contenir un objet JSON.'], warnings, team: null };
  }

  const name = team.name;
  if (!isValidName(name)) errors.push(`name : « ${name ?? ''} » doit être en kebab-case (ex. « software-dev »).`);
  const folder = expectedName ?? path.basename(dir);
  if (isValidName(name) && !folder.startsWith('.tmp-') && name !== folder) {
    errors.push(`name : « ${name} » ne correspond pas au nom du dossier « ${folder} ».`);
  }
  if (typeof team.version !== 'string' || !SEMVER_RE.test(team.version)) {
    errors.push(`version : « ${team.version ?? ''} » doit suivre le format semver (ex. « 1.0.0 »).`);
  }
  if (typeof team.description !== 'string' || !team.description.trim()) errors.push('description : obligatoire.');
  if (team.author !== undefined && typeof team.author !== 'string') errors.push('author : doit être une chaîne.');
  if (!team.author) warnings.push('author : non renseigné.');
  if (team.tags !== undefined && (!Array.isArray(team.tags) || team.tags.some((t) => typeof t !== 'string'))) {
    errors.push('tags : doit être une liste de chaînes.');
  }
  const mode = team.mode ?? 'subagents';
  if (!MODES.includes(mode)) errors.push(`mode : « ${mode} » invalide (attendu : ${MODES.join(' ou ')}).`);

  const agents = Array.isArray(team.agents) ? team.agents : null;
  if (!agents || agents.length === 0) {
    errors.push('agents : la team doit déclarer au moins un agent.');
  } else {
    const seen = new Set();
    for (const [i, a] of agents.entries()) {
      const label = a?.name ?? `#${i + 1}`;
      if (!a || typeof a !== 'object') {
        errors.push(`agents[${i}] : doit être un objet { "name", "enabled" }.`);
        continue;
      }
      if (!isValidName(a.name)) {
        errors.push(`agent « ${label} » : le nom doit être en kebab-case.`);
        continue;
      }
      if (seen.has(a.name)) errors.push(`agent « ${a.name} » : déclaré deux fois.`);
      seen.add(a.name);
      if (a.enabled !== undefined && typeof a.enabled !== 'boolean') errors.push(`agent « ${a.name} » : enabled doit valoir true ou false.`);
      validateAgentFile(dir, a.name, errors, warnings);
    }
    if (!team.lead) errors.push('lead : obligatoire (nom de l\'agent qui coordonne la team).');
    else if (!seen.has(team.lead)) errors.push(`lead : l'agent « ${team.lead} » n'existe pas dans la liste des agents.`);

    const agentsDir = path.join(dir, 'agents');
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (f.endsWith('.md') && !seen.has(f.slice(0, -3))) warnings.push(`agents/${f} : fichier non déclaré dans team.json (ignoré).`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, team };
}

function validateAgentFile(dir, name, errors, warnings) {
  const agent = readAgent(dir, name);
  const rel = `agents/${name}.md`;
  if (!agent) {
    errors.push(`${rel} : fichier introuvable.`);
    return;
  }
  if (!agent.frontmatter) {
    errors.push(`${rel} : frontmatter absent (bloc --- en tête de fichier avec name, description, tools, model).`);
    return;
  }
  const fm = agent.frontmatter;
  if (!fm.name) errors.push(`${rel} : le champ « name » est obligatoire.`);
  else if (fm.name !== name) errors.push(`${rel} : name « ${fm.name} » différent du nom de fichier « ${name} ».`);
  if (!fm.description) errors.push(`${rel} : le champ « description » est obligatoire.`);
  if (!fm.tools) {
    warnings.push(`${rel} : pas de « tools » — l'agent hériterait de tous les outils. Restreignez-les à son rôle.`);
  } else {
    for (const tool of splitTools(fm.tools)) {
      const base = tool.replace(/\(.*\)$/, '');
      if (!KNOWN_TOOLS.includes(base) && !base.startsWith('mcp__')) warnings.push(`${rel} : outil inconnu « ${tool} ».`);
    }
  }
  if (fm.model && !MODELS.includes(fm.model) && !fm.model.startsWith('claude-')) {
    warnings.push(`${rel} : modèle « ${fm.model} » inhabituel (attendu : ${MODELS.join(', ')}).`);
  }
  if (agent.body.trim().length < 40) warnings.push(`${rel} : prompt système très court.`);
}

export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

export function teamFiles(team) {
  return ['team.json', ...team.agents.map((a) => `agents/${a.name}.md`)];
}
