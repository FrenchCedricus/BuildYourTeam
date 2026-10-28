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

// Seules ces clés sont acceptées dans le frontmatter d'un agent : une team du registry ne doit pas
// pouvoir déclarer permissionMode, hooks, mcpServers ou d'autres réglages qui élargissent ses droits.
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
  return { file, text, frontmatter: fm?.data ?? null, duplicates: fm?.duplicates ?? [], body: fm?.body ?? text };
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
    else {
      // Le lead coordonne : s'il peut modifier ou exécuter, c'est presque toujours une erreur de conception.
      const leadTools = splitTools(readAgent(dir, team.lead)?.frontmatter?.tools).map((t) => t.replace(/\(.*\)$/, ''));
      const risky = leadTools.filter((t) => WRITE_TOOLS.includes(t));
      if (risky.length) warnings.push(`lead « ${team.lead} » : a des droits de modification ou d'exécution (${risky.join(', ')}) ; un lead devrait rester en lecture seule.`);
    }

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
  for (const key of Object.keys(fm)) {
    if (!ALLOWED_FRONTMATTER_KEYS.includes(key)) {
      errors.push(`${rel} : clé « ${key} » non autorisée dans le frontmatter (autorisées : ${ALLOWED_FRONTMATTER_KEYS.join(', ')}).`);
    }
  }
  for (const key of new Set(agent.duplicates)) errors.push(`${rel} : clé « ${key} » déclarée plusieurs fois.`);
  if (!fm.name) errors.push(`${rel} : le champ « name » est obligatoire.`);
  else if (fm.name !== name) errors.push(`${rel} : name « ${fm.name} » différent du nom de fichier « ${name} ».`);
  if (!fm.description) errors.push(`${rel} : le champ « description » est obligatoire.`);
  if (!fm.tools) {
    errors.push(`${rel} : le champ « tools » est obligatoire (sans lui, l'agent hériterait de tous les outils).`);
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

// Comparaison semver : majeur.mineur.patch, puis une pré-release (1.0.0-beta) passe avant la version finale.
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
