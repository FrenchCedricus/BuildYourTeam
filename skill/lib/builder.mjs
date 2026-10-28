import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BytError, errors } from './errors.mjs';
import { scopePaths } from './context.mjs';
import { loadState, saveState } from './state.mjs';
import { isValidName, validateTeam, saveTeam, loadTeam, readAgent, agentPath } from './team.mjs';
import { renderFrontmatter, setFrontmatterField, splitTools } from './frontmatter.mjs';
import { exists, writeText, tempDirIn, replaceDir, removeDir } from './fsutil.mjs';
import { syncScope } from './sync.mjs';
import { trustTeam } from './trust.mjs';
import { ACCESS_LEVELS, normalizeAccess, normalizeModel, defaultsFor, templatePrompt, isLeadName, accessFromTools } from './roles.mjs';

// Format des données acceptées par new / add-agent :
// {
//   "name": "my-team", "description": "Objectif en une phrase", "author": "...", "tags": [],
//   "mode": "subagents" | "agent-team", "lead": "lead",
//   "agents": [
//     { "name": "backend", "role": "Rôle en une ligne", "access": "read|write|exec",
//       "model": "haiku|sonnet|opus", "prompt": "Prompt système (optionnel)", "tools": [] (optionnel),
//       "enabled": true }
//   ]
// }

export function parseData(raw, label = '--data') {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'object') {
    if (Array.isArray(raw)) throw errors.invalidJson(label, 'un objet JSON est attendu');
    return raw;
  }
  const text = String(raw).replace(/^﻿/, '').trim();
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('un objet JSON est attendu');
    return data;
  } catch (e) {
    throw errors.invalidJson(label, e.message);
  }
}

function fail(code, message, hint) {
  return new BytError(code, message, hint);
}

function resolveAccess(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const a = normalizeAccess(value);
  if (!a) throw fail('INVALID_ACCESS', `Niveau d'accès inconnu : « ${value} ».`, 'Valeurs possibles : read (lecture seule), write (modification de fichiers), exec (exécution de commandes).');
  return a;
}

function resolveModel(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const m = normalizeModel(value);
  if (!m) throw fail('INVALID_MODEL', `Modèle inconnu : « ${value} ».`, 'Valeurs possibles : haiku (rapide), sonnet (équilibré), opus (puissant).');
  return m;
}

function resolveTools(spec, access) {
  if (spec.tools === undefined) return ACCESS_LEVELS[access].tools;
  const tools = Array.isArray(spec.tools) ? spec.tools : splitTools(spec.tools);
  if (tools.length === 0) throw fail('INVALID_TOOLS', `Agent « ${spec.name} » : la liste d'outils est vide.`);
  return tools;
}

// Construit un agent complet à partir d'une spec partielle.
export function buildAgent(spec, { team, goal, isLead = false, teammates = [] }) {
  if (!spec || typeof spec !== 'object') throw fail('INVALID_AGENT', 'Chaque agent doit être un objet JSON.');
  if (!isValidName(spec.name)) throw errors.invalidName('agent', spec.name ?? '');
  const d = defaultsFor(spec.name, { isLead });
  const role = String(spec.role ?? spec.description ?? d.role).trim().replace(/\.$/, '');
  const access = resolveAccess(spec.access, d.access);
  const model = resolveModel(spec.model, d.model);
  const tools = resolveTools(spec, access);
  const description = String(spec.description ?? role).trim();
  const given = spec.prompt ? String(spec.prompt).trim() : '';
  const prompt = given || templatePrompt({ name: spec.name, role, access, team, goal, isLead, teammates });
  return { name: spec.name, role, access, model, tools, description, prompt, enabled: spec.enabled !== false, generated: !given };
}

export function renderAgent(agent) {
  return renderFrontmatter(
    { name: agent.name, description: agent.description, tools: agent.tools.join(', '), model: agent.model },
    agent.prompt
  );
}

function summarize(dir, name, isLead) {
  const a = readAgent(dir, name);
  const fm = a?.frontmatter ?? {};
  const tools = splitTools(fm.tools);
  return { name, lead: isLead, role: fm.description ?? '', tools, access: accessFromTools(tools), model: fm.model ?? 'inherit' };
}

function chooseLead(data, specs, base) {
  const names = specs.map((s) => s.name);
  if (data.lead) {
    if (!names.includes(data.lead)) throw fail('INVALID_LEAD', `Le lead « ${data.lead} » ne fait pas partie des agents de la team.`);
    return data.lead;
  }
  if (base && names.includes(base.team.lead)) return base.team.lead;
  return names.find((n) => isLeadName(n)) ?? names[0];
}

// Crée une team locale. `base` ({ dir, team }) permet de partir d'une team existante.
export function createTeam(ctx, data, { scope, base = null, force = false }) {
  const name = data.name;
  if (!name) throw fail('MISSING_NAME', 'Le nom de la team est obligatoire.', 'Exemple : byt new ma-team --data \'{"description":"...","agents":[...]}\'');
  if (!isValidName(name)) throw errors.invalidName('team', name);
  const description = String(data.description ?? base?.team.description ?? '').trim();
  if (!description) throw fail('MISSING_DESCRIPTION', 'L\'objectif de la team (description) est obligatoire.');
  const mode = data.mode ?? base?.team.mode ?? 'subagents';
  if (!['subagents', 'agent-team'].includes(mode)) throw fail('INVALID_MODE', `Mode inconnu : « ${mode} ».`, 'Valeurs possibles : subagents, agent-team.');

  const sp = scopePaths(ctx, scope);
  const state = loadState(sp);
  const dest = path.join(sp.teamsDir, name);
  if ((Object.hasOwn(state.teams, name) || exists(dest)) && !force) throw errors.teamExists(name, scope);

  let specs = data.agents;
  if (specs === undefined && base) specs = base.team.agents.map((a) => ({ name: a.name, enabled: a.enabled }));
  if (!Array.isArray(specs) || specs.length === 0) throw fail('NO_AGENTS', 'La team doit contenir au moins un agent.');
  const seen = new Set();
  for (const s of specs) {
    if (!isValidName(s?.name)) throw errors.invalidName('agent', s?.name ?? '');
    if (seen.has(s.name)) throw fail('DUPLICATE_AGENT', `L'agent « ${s.name} » est déclaré deux fois.`);
    seen.add(s.name);
  }
  const lead = chooseLead(data, specs, base);

  // Rôles connus de toute la team, pour le prompt du lead.
  const teammates = specs
    .filter((s) => s.name !== lead)
    .map((s) => {
      const fromBase = base ? readAgent(base.dir, s.name)?.frontmatter?.description : null;
      return { name: s.name, role: String(s.role ?? s.description ?? fromBase ?? defaultsFor(s.name).role).replace(/\.$/, '') };
    });

  const tmp = tempDirIn(sp.teamsDir, name);
  try {
    for (const spec of specs) {
      const isLead = spec.name === lead;
      const baseAgent = base ? readAgent(base.dir, spec.name) : null;
      if (baseAgent && spec.prompt === undefined && spec.role === undefined) {
        // Agent repris tel quel de la team d'origine ; seuls l'accès et le modèle peuvent changer.
        let text = baseAgent.text;
        if (spec.access !== undefined || spec.tools !== undefined) {
          const access = resolveAccess(spec.access, accessFromTools(splitTools(baseAgent.frontmatter?.tools)));
          text = setFrontmatterField(text, 'tools', resolveTools(spec, access).join(', '));
        }
        if (spec.model !== undefined) text = setFrontmatterField(text, 'model', resolveModel(spec.model));
        writeText(agentPath(tmp, spec.name), text);
      } else {
        const agent = buildAgent(spec, { team: name, goal: description, isLead, teammates });
        writeText(agentPath(tmp, spec.name), renderAgent(agent));
      }
    }

    const team = {
      name,
      version: data.version ?? '0.1.0',
      description,
      author: data.author ?? defaultAuthor(ctx),
      tags: data.tags ?? base?.team.tags ?? [],
      lead,
      mode,
      agents: specs.map((s) => ({ name: s.name, enabled: s.enabled !== false })),
    };
    saveTeam(tmp, team);

    const v = validateTeam(tmp, { expectedName: name });
    if (!v.ok) {
      const err = fail('TEAM_INVALID', `La team « ${name} » générée est invalide.`);
      err.details = v.errors.map((e) => `  erreur  ${e}`).join('\n');
      throw err;
    }

    replaceDir(tmp, dest);
    const fresh = loadState(sp);
    fresh.teams[name] = {
      version: team.version,
      source: 'local',
      enabled: true,
      createdAt: new Date().toISOString(),
      ...(base ? { from: base.team.name } : {}),
    };
    saveState(sp, fresh);
    if (scope === 'project') trustTeam(ctx, dest);
    const sync = syncScope(ctx, scope);
    return {
      team: name,
      version: team.version,
      scope,
      dir: dest,
      mode,
      lead,
      from: base?.team.name ?? null,
      agents: team.agents.map((a) => ({ ...summarize(dest, a.name, a.name === lead), enabled: a.enabled })),
      validation: { ok: true, warnings: v.warnings },
      sync,
    };
  } catch (e) {
    removeDir(tmp);
    throw e;
  }
}

function defaultAuthor(ctx) {
  if (ctx.env.BYT_AUTHOR) return ctx.env.BYT_AUTHOR;
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

export function addAgent(ctx, found, spec) {
  const team = loadTeam(found.dir);
  if (!spec?.name) throw fail('MISSING_NAME', 'Le nom de l\'agent est obligatoire.');
  if (team.agents.some((a) => a.name === spec.name)) {
    throw fail('AGENT_EXISTS', `L'agent « ${spec.name} » existe déjà dans la team « ${team.name} ».`, `Retirez-le d'abord : byt remove-agent ${team.name} ${spec.name}`);
  }
  const agent = buildAgent(spec, { team: team.name, goal: team.description, isLead: false });
  const file = agentPath(found.dir, agent.name);
  writeText(file, renderAgent(agent));
  team.agents.push({ name: agent.name, enabled: agent.enabled });
  saveTeam(found.dir, team);
  const v = validateTeam(found.dir);
  if (!v.ok) {
    team.agents = team.agents.filter((a) => a.name !== agent.name);
    saveTeam(found.dir, team);
    fs.rmSync(file, { force: true });
    const err = fail('TEAM_INVALID', 'L\'ajout rendrait la team invalide : annulé.');
    err.details = v.errors.map((e) => `  erreur  ${e}`).join('\n');
    throw err;
  }
  const sync = syncScope(ctx, found.scope);
  return { team: team.name, scope: found.scope, agent: summarize(found.dir, agent.name, false), validation: { ok: true, warnings: v.warnings }, sync };
}

export function removeAgent(ctx, found, agentName) {
  const team = loadTeam(found.dir);
  if (!team.agents.some((a) => a.name === agentName)) throw errors.agentNotFound(team.name, agentName);
  if (team.lead === agentName) {
    throw fail('CANNOT_REMOVE_LEAD', `« ${agentName} » est le lead de la team : il ne peut pas être retiré.`, `Désactivez-le plutôt : byt disable ${team.name} ${agentName}`);
  }
  team.agents = team.agents.filter((a) => a.name !== agentName);
  saveTeam(found.dir, team);
  fs.rmSync(agentPath(found.dir, agentName), { force: true });
  const sync = syncScope(ctx, found.scope);
  return { team: team.name, scope: found.scope, removed: agentName, sync };
}
