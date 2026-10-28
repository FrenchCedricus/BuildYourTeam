import path from 'node:path';
import { BytError, errors, scopeLabel } from './errors.mjs';
import { availableScopes, scopePaths, searchScopes, resolveScope, agentTeamsEnabled } from './context.mjs';
import { validateTeam, loadTeam, saveTeam, readAgent, isValidName, compareVersions } from './team.mjs';
import { splitTools } from './frontmatter.mjs';
import { syncScope, formatSync, agentId } from './sync.mjs';
import { fetchRegistry, findEntry, downloadTeam, searchRegistry } from './registry.mjs';
import { loadConfig, setConfig, CONFIG_KEYS } from './config.mjs';
import { loadState, saveState } from './state.mjs';
import { readJson, exists, removeDir, replaceDir, tempDirIn } from './fsutil.mjs';
import { table } from './format.mjs';

export const VERSION = '0.1.0';

// ---------------------------------------------------------------- aide

const HELP = [
  ['help [commande]', 'Affiche cette aide'],
  ['list', 'Teams installées, avec leurs agents actifs/inactifs'],
  ['list --available', 'Teams disponibles dans le registry'],
  ['search <mot>', 'Cherche dans le registry (nom, description, tags)'],
  ['info <team>', "Détail d'une team et de ses agents"],
  ['install <team>', 'Installe une team depuis le registry'],
  ['uninstall <team>', 'Désinstalle une team'],
  ['update [team]', 'Met à jour une team, ou toutes'],
  ['enable <team> [agent]', 'Active une team ou un agent'],
  ['disable <team> [agent]', 'Désactive une team ou un agent'],
  ['use <team>', 'Active une team et synchronise ses agents'],
  ['run <team> <tâche...>', 'Lance la team sur une tâche (dans Claude Code)'],
  ['new [team]', 'Crée une team (assistant interactif)'],
  ['add-agent <team>', 'Ajoute un agent à une team'],
  ['remove-agent <team> <agent>', "Retire un agent d'une team"],
  ['validate [team|dossier]', 'Vérifie une team (--strict : avertissements bloquants)'],
  ['sync', 'Resynchronise les agents dans .claude/agents'],
  ['config [clé] [valeur]', 'Affiche ou modifie la configuration'],
];

const OPTIONS = [
  ['--project', 'Agit sur le projet courant (./.byt, ./.claude/agents)'],
  ['--global', 'Agit sur la portée globale (~/.byt, ~/.claude/agents)'],
  ['--json', 'Sortie JSON (pour scripts et interfaces)'],
  ['--data <json|->', 'Données JSON pour new/add-agent (« - » : lecture sur stdin)'],
  ['--from <team>', 'Part d\'une team existante (new)'],
  ['--force', 'Remplace une team existante (install, new, update)'],
];

function help(ctx) {
  const { c } = ctx;
  const text = [
    `${c.bold('BuildYourTeam')} ${c.dim('v' + VERSION)} — des teams de subagents Claude Code`,
    '',
    c.bold('Commandes'),
    table(HELP.map(([cmd, desc]) => [c.cyan(cmd), desc])),
    '',
    c.bold('Options'),
    table(OPTIONS.map(([opt, desc]) => [c.cyan(opt), desc])),
    '',
    c.dim('Dans Claude Code : /byt <commande>   ·   En terminal : node byt.mjs <commande>'),
  ].join('\n');
  return {
    text,
    data: {
      version: VERSION,
      commands: HELP.map(([usage, description]) => ({ usage, description })),
      options: OPTIONS.map(([option, description]) => ({ option, description })),
    },
  };
}

function version() {
  return { text: VERSION, data: { version: VERSION } };
}

// ---------------------------------------------------------------- teams installées

// Liste les teams d'une portée telles que décrites par state.json et leurs team.json.
export function installedTeams(ctx, scope) {
  const sp = scopePaths(ctx, scope);
  const state = loadState(sp);
  return Object.entries(state.teams).map(([name, info]) => {
    const dir = path.join(sp.teamsDir, name);
    const manifestPath = path.join(dir, 'team.json');
    const team = exists(manifestPath) ? readJson(manifestPath, null) : null;
    return { name, scope, dir, info, team };
  });
}

function summarizeInstalled(entry) {
  const { name, scope, dir, info, team } = entry;
  return {
    name,
    scope,
    dir,
    version: team?.version ?? info.version ?? null,
    source: info.source ?? 'registry',
    enabled: info.enabled !== false,
    mode: team?.mode ?? 'subagents',
    lead: team?.lead ?? null,
    description: team?.description ?? '',
    broken: !team,
    agents: (team?.agents ?? []).map((a) => ({ name: a.name, enabled: a.enabled !== false })),
  };
}

function list(ctx, args) {
  if (args.flags.available) return COMMANDS['list-available'](ctx, args);
  const { c } = ctx;
  const teams = availableScopes(ctx).flatMap((scope) => installedTeams(ctx, scope).map(summarizeInstalled));

  if (teams.length === 0) {
    return {
      data: { teams },
      text: `Aucune team installée.\n  ${c.dim('→')} Voir les teams disponibles : /byt list --available`,
    };
  }

  const lines = [c.bold(`Teams installées (${teams.length})`), ''];
  for (const t of teams) {
    const status = t.enabled ? c.green('● active') : c.yellow('○ inactive');
    const tags = [scopeLabel(t.scope), t.source === 'local' ? 'locale' : null, t.mode === 'agent-team' ? 'agent-team' : null]
      .filter(Boolean)
      .join(', ');
    lines.push(`${c.bold(t.name)} ${c.dim('v' + (t.version ?? '?'))}  ${status}  ${c.dim('[' + tags + ']')}`);
    if (t.broken) {
      lines.push(`  ${c.red('team.json introuvable — réinstallez la team')}`);
    } else {
      const agents = t.agents.map((a) => {
        const label = a.name === t.lead ? `${a.name} (lead)` : a.name;
        return a.enabled ? c.green('✔ ') + label : c.dim('✖ ' + label);
      });
      lines.push('  ' + agents.join('   '));
    }
    lines.push('');
  }
  return { data: { teams }, text: lines.join('\n').trimEnd() };
}

// ---------------------------------------------------------------- configuration

function config(ctx, args) {
  const { c } = ctx;
  const [key, value] = args._;
  if (key && value !== undefined) {
    const cfg = setConfig(ctx, key, value);
    return { data: { config: cfg }, text: `${c.green('✔')} ${key} = ${cfg[key]}` };
  }
  const cfg = loadConfig(ctx);
  if (key) {
    if (!(key in CONFIG_KEYS)) throw errors.usage('config [registry] [valeur]');
    return { data: { [key]: cfg[key] }, text: String(cfg[key]) };
  }
  const rows = Object.keys(CONFIG_KEYS).map((k) => [c.cyan(k), cfg[k], c.dim(CONFIG_KEYS[k])]);
  return {
    data: { config: cfg, paths: { bytHome: ctx.bytHome, claudeDir: ctx.claudeDir } },
    text: [c.bold('Configuration'), table(rows), '', c.dim(`Fichier : ${path.join(ctx.bytHome, 'config.json')}`)].join('\n'),
  };
}

// ---------------------------------------------------------------- recherche d'une team installée

// Cherche la team dans les portées autorisées (projet d'abord, puis global).
export function findInstalled(ctx, name, flags = {}) {
  for (const scope of searchScopes(ctx, flags)) {
    const sp = scopePaths(ctx, scope);
    const state = loadState(sp);
    const dir = path.join(sp.teamsDir, name);
    if (state.teams[name] && exists(path.join(dir, 'team.json'))) {
      return { scope, sp, state, dir, info: state.teams[name] };
    }
  }
  return null;
}

export function requireInstalled(ctx, name, flags) {
  if (!name) throw errors.usage('byt <commande> <team>');
  const found = findInstalled(ctx, name, flags);
  if (!found) throw errors.teamNotInstalled(name);
  return found;
}

// ---------------------------------------------------------------- validation

function formatValidation(c, label, result) {
  const lines = [];
  const head = result.ok ? c.green('✔') : c.red('✖');
  lines.push(`${head} ${c.bold(label)}${result.ok ? ' : valide' : ' : invalide'}`);
  for (const e of result.errors) lines.push(`  ${c.red('erreur')}  ${e}`);
  for (const w of result.warnings) lines.push(`  ${c.yellow('attention')}  ${w}`);
  return lines.join('\n');
}

function validate(ctx, args) {
  const { c } = ctx;
  const target = args._[0];
  const strict = Boolean(args.flags.strict);
  const targets = [];

  if (target && (target.includes('/') || target.includes('\\') || target.startsWith('.') || exists(path.join(path.resolve(ctx.cwd, target), 'team.json')))) {
    targets.push({ label: target, dir: path.resolve(ctx.cwd, target) });
  } else if (target) {
    const found = requireInstalled(ctx, target, args.flags);
    targets.push({ label: target, dir: found.dir });
  } else {
    for (const scope of availableScopes(ctx)) {
      for (const t of installedTeams(ctx, scope)) targets.push({ label: `${t.name} (${scopeLabel(scope)})`, dir: t.dir });
    }
  }

  const results = targets.map(({ label, dir }) => {
    const r = validateTeam(dir);
    const ok = r.ok && (!strict || r.warnings.length === 0);
    return { label, dir, ok, errors: r.errors, warnings: r.warnings };
  });
  const ok = results.every((r) => r.ok);
  const text = results.length === 0 ? 'Aucune team à valider.' : results.map((r) => formatValidation(c, r.label, r)).join('\n');
  if (!ok) {
    const err = new BytError('VALIDATION_FAILED', strict ? 'Validation échouée (mode strict).' : 'Validation échouée.');
    err.hint = 'Corrigez les erreurs ci-dessus puis relancez : byt validate';
    err.details = text;
    err.data = { results };
    throw err;
  }
  return { data: { ok, results }, text };
}

// ---------------------------------------------------------------- activation

function setEnabled(ctx, args, enabled) {
  const { c } = ctx;
  const [teamName, agentName] = args._;
  if (!teamName) throw errors.usage(`byt ${enabled ? 'enable' : 'disable'} <team> [agent]`);
  const found = requireInstalled(ctx, teamName, args.flags);
  const warnings = [];
  let message;

  if (agentName) {
    const team = loadTeam(found.dir);
    const agent = team.agents.find((a) => a.name === agentName);
    if (!agent) throw errors.agentNotFound(teamName, agentName);
    agent.enabled = enabled;
    saveTeam(found.dir, team);
    if (!enabled && agentName === team.lead) {
      warnings.push(`« ${agentName} » est le lead : /byt run coordonnera la team sans son prompt de lead.`);
    }
    if (enabled && found.info.enabled === false) {
      warnings.push(`La team « ${teamName} » est inactive : activez-la avec /byt enable ${teamName}.`);
    }
    message = `Agent ${c.bold(agentName)} de ${c.bold(teamName)} ${enabled ? 'activé' : 'désactivé'}.`;
  } else {
    found.state.teams[teamName].enabled = enabled;
    saveState(found.sp, found.state);
    message = `Team ${c.bold(teamName)} ${enabled ? 'activée' : 'désactivée'}.`;
  }

  const sync = syncScope(ctx, found.scope);
  const lines = [`${c.green('✔')} ${message}`, ...warnings.map((w) => `  ${c.yellow('attention')}  ${w}`), formatSync(c, sync)];
  return {
    data: { team: teamName, agent: agentName ?? null, enabled, scope: found.scope, warnings, sync },
    text: lines.join('\n'),
  };
}

function enable(ctx, args) {
  return setEnabled(ctx, args, true);
}

function disable(ctx, args) {
  return setEnabled(ctx, args, false);
}

// « use » : active la team et confirme quels agents sont disponibles dans Claude Code.
function use(ctx, args) {
  const { c } = ctx;
  const teamName = args._[0];
  if (!teamName) throw errors.usage('byt use <team>');
  const found = requireInstalled(ctx, teamName, args.flags);
  found.state.teams[teamName].enabled = true;
  saveState(found.sp, found.state);
  const sync = syncScope(ctx, found.scope);
  const team = loadTeam(found.dir);
  const active = team.agents.filter((a) => a.enabled !== false).map((a) => ({ name: a.name, subagent: agentId(teamName, a.name) }));
  const lines = [
    `${c.green('✔')} Team ${c.bold(teamName)} prête : ${active.length} agent(s) actif(s).`,
    ...active.map((a) => `  ${c.cyan(a.subagent)}`),
    formatSync(c, sync),
    '',
    `${c.dim('→')} Lancez-la : /byt run ${teamName} <tâche>`,
  ];
  return { data: { team: teamName, scope: found.scope, agents: active, sync }, text: lines.join('\n') };
}

function sync(ctx, args) {
  const { c } = ctx;
  const scopes = args.flags.project || args.flags.global ? searchScopes(ctx, args.flags) : availableScopes(ctx);
  const results = scopes.map((s) => syncScope(ctx, s));
  return { data: { results }, text: results.map((r) => formatSync(c, r)).join('\n') };
}

// ---------------------------------------------------------------- registry

function installedNames(ctx) {
  const names = new Map();
  for (const scope of availableScopes(ctx)) {
    for (const name of Object.keys(loadState(scopePaths(ctx, scope)).teams)) {
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(scope);
    }
  }
  return names;
}

function registryRows(c, teams, installed) {
  return teams.map((t) => {
    const mark = installed.has(t.name) ? c.green('✔ installée') : '';
    return [c.bold(t.name), c.dim('v' + t.version), t.description, c.dim((t.tags ?? []).join(', ')), mark];
  });
}

async function listAvailable(ctx) {
  const { c } = ctx;
  const registry = await fetchRegistry(ctx);
  const installed = installedNames(ctx);
  const teams = registry.teams.map((t) => ({ ...t, installed: installed.has(t.name), installedIn: installed.get(t.name) ?? [] }));
  const text = teams.length
    ? [c.bold(`Teams disponibles (${teams.length})`), '', table(registryRows(c, teams, installed)), '', `${c.dim('→')} Installer : /byt install <team>`].join('\n')
    : 'Le registry ne contient aucune team.';
  return { data: { registry: registry.base, teams }, text };
}

async function search(ctx, args) {
  const { c } = ctx;
  const term = args._.join(' ').trim();
  if (!term) throw errors.usage('byt search <mot>');
  const registry = await fetchRegistry(ctx);
  const installed = installedNames(ctx);
  const results = searchRegistry(registry, term).map((t) => ({ ...t, installed: installed.has(t.name) }));
  const text = results.length
    ? [c.bold(`${results.length} résultat(s) pour « ${term} »`), '', table(registryRows(c, results, installed))].join('\n')
    : `Aucune team ne correspond à « ${term} ».\n  ${c.dim('→')} Toutes les teams : /byt list --available`;
  return { data: { term, results }, text };
}

// Télécharge une team dans un dossier temporaire et la valide avant de l'installer.
async function stageFromRegistry(registry, entry, teamsDir) {
  const tmp = tempDirIn(teamsDir, entry.name);
  try {
    await downloadTeam(registry, entry, tmp);
    const v = validateTeam(tmp, { expectedName: entry.name });
    if (!v.ok) {
      const err = new BytError('TEAM_INVALID', `La team « ${entry.name} » du registry est invalide, installation annulée.`);
      err.details = v.errors.map((e) => `  erreur  ${e}`).join('\n');
      throw err;
    }
    return { tmp, team: v.team };
  } catch (e) {
    removeDir(tmp);
    throw e;
  }
}

async function install(ctx, args) {
  const { c } = ctx;
  const name = args._[0];
  if (!name) throw errors.usage('byt install <team> [--project]');
  if (!isValidName(name)) throw errors.invalidName('team', name);
  const scope = resolveScope(ctx, args.flags, 'global');
  const sp = scopePaths(ctx, scope);
  const state = loadState(sp);
  const dest = path.join(sp.teamsDir, name);
  if ((state.teams[name] || exists(dest)) && !args.flags.force) throw errors.teamExists(name, scope);

  const registry = await fetchRegistry(ctx);
  const entry = findEntry(registry, name);
  if (!entry) throw errors.teamNotInRegistry(name);
  const { tmp, team } = await stageFromRegistry(registry, entry, sp.teamsDir);
  replaceDir(tmp, dest);

  state.teams[name] = { version: team.version, source: 'registry', enabled: true, installedAt: new Date().toISOString() };
  saveState(sp, state);
  const sync = syncScope(ctx, scope);
  const lines = [
    `${c.green('✔')} Team ${c.bold(name)} ${c.dim('v' + team.version)} installée (${scopeLabel(scope)}) : ${team.agents.length} agent(s).`,
    formatSync(c, sync),
    '',
    `${c.dim('→')} Lancez-la : /byt run ${name} <tâche>`,
  ];
  return { data: { team: name, version: team.version, scope, dir: dest, sync }, text: lines.join('\n') };
}

function uninstall(ctx, args) {
  const { c } = ctx;
  const name = args._[0];
  if (!name) throw errors.usage('byt uninstall <team>');
  const found = requireInstalled(ctx, name, args.flags);
  if (found.info.source === 'local' && !args.flags.force) {
    throw new BytError(
      'LOCAL_TEAM_DELETE',
      `La team « ${name} » est locale (créée par vous) : la désinstaller la supprime définitivement.`,
      `Confirmez avec : byt uninstall ${name} --force`
    );
  }
  removeDir(found.dir);
  delete found.state.teams[name];
  saveState(found.sp, found.state);
  const sync = syncScope(ctx, found.scope);
  return {
    data: { team: name, scope: found.scope, sync },
    text: [`${c.green('✔')} Team ${c.bold(name)} désinstallée (${scopeLabel(found.scope)}).`, formatSync(c, sync)].join('\n'),
  };
}

async function update(ctx, args) {
  const { c } = ctx;
  const name = args._[0];
  const targets = name
    ? [requireInstalled(ctx, name, args.flags)].map((f) => ({ name, ...f }))
    : searchScopes(ctx, args.flags).flatMap((scope) => {
        const sp = scopePaths(ctx, scope);
        return Object.entries(loadState(sp).teams).map(([n, info]) => ({ name: n, scope, sp, info, dir: path.join(sp.teamsDir, n) }));
      });

  const results = [];
  if (targets.length === 0) return { data: { results }, text: 'Aucune team installée à mettre à jour.' };

  const remote = targets.some((t) => t.info.source !== 'local') ? await fetchRegistry(ctx) : null;
  const touched = new Set();

  for (const t of targets) {
    const current = exists(path.join(t.dir, 'team.json')) ? loadTeam(t.dir) : null;
    const from = current?.version ?? t.info.version ?? '0.0.0';
    if (t.info.source === 'local') {
      results.push({ team: t.name, scope: t.scope, status: 'local', version: from });
      continue;
    }
    const entry = findEntry(remote, t.name);
    if (!entry) {
      results.push({ team: t.name, scope: t.scope, status: 'not-in-registry', version: from });
      continue;
    }
    if (current && compareVersions(entry.version, from) <= 0 && !args.flags.force) {
      results.push({ team: t.name, scope: t.scope, status: 'up-to-date', version: from });
      continue;
    }
    const { tmp, team } = await stageFromRegistry(remote, entry, t.sp.teamsDir);
    // Les choix d'activation de l'utilisateur survivent à la mise à jour.
    const previous = new Map((current?.agents ?? []).map((a) => [a.name, a.enabled !== false]));
    for (const a of team.agents) if (previous.has(a.name)) a.enabled = previous.get(a.name);
    saveTeam(tmp, team);
    replaceDir(tmp, t.dir);
    const state = loadState(t.sp);
    state.teams[t.name] = { ...state.teams[t.name], version: team.version, updatedAt: new Date().toISOString() };
    saveState(t.sp, state);
    touched.add(t.scope);
    results.push({ team: t.name, scope: t.scope, status: 'updated', from, version: team.version });
  }

  const syncs = [...touched].map((s) => syncScope(ctx, s));
  const label = {
    updated: (r) => `${c.green('✔')} ${c.bold(r.team)} : ${r.from} → ${r.version}`,
    'up-to-date': (r) => `${c.dim('=')} ${c.bold(r.team)} : déjà à jour (${r.version})`,
    local: (r) => `${c.dim('-')} ${c.bold(r.team)} : team locale, ignorée`,
    'not-in-registry': (r) => `${c.yellow('?')} ${c.bold(r.team)} : absente du registry, ignorée`,
  };
  const lines = [...results.map((r) => label[r.status](r)), ...syncs.map((s) => formatSync(c, s))];
  return { data: { results, sync: syncs }, text: lines.join('\n') };
}

// ---------------------------------------------------------------- détail d'une team

export function describeInstalled(ctx, found) {
  const team = loadTeam(found.dir);
  const name = team.name;
  const agents = team.agents.map((a) => {
    const file = readAgent(found.dir, a.name);
    const fm = file?.frontmatter ?? {};
    const subagent = agentId(name, a.name);
    return {
      name: a.name,
      enabled: a.enabled !== false,
      lead: a.name === team.lead,
      description: fm.description ?? '',
      tools: splitTools(fm.tools),
      model: fm.model ?? 'inherit',
      file: file?.file ?? null,
      subagent,
      synced: exists(path.join(found.sp.agentsDir, `${subagent}.md`)),
    };
  });
  return {
    installed: true,
    name,
    version: team.version,
    description: team.description,
    author: team.author ?? '',
    tags: team.tags ?? [],
    mode: team.mode ?? 'subagents',
    lead: team.lead,
    leadFile: agents.find((a) => a.lead)?.file ?? null,
    scope: found.scope,
    source: found.info.source ?? 'registry',
    enabled: found.info.enabled !== false,
    dir: found.dir,
    agentsDir: found.sp.agentsDir,
    agentTeamsEnabled: agentTeamsEnabled(ctx),
    agents,
  };
}

async function info(ctx, args) {
  const { c } = ctx;
  const name = args._[0];
  if (!name) throw errors.usage('byt info <team>');
  const found = findInstalled(ctx, name, args.flags);

  if (!found) {
    let entry = null;
    try {
      entry = findEntry(await fetchRegistry(ctx), name);
    } catch {
      // registry injoignable : on signale simplement que la team n'est pas installée
    }
    if (!entry) throw errors.teamNotInstalled(name);
    const text = [
      `${c.bold(entry.name)} ${c.dim('v' + entry.version)}  ${c.yellow('non installée')}`,
      entry.description,
      c.dim(`Auteur : ${entry.author ?? '?'} · Tags : ${(entry.tags ?? []).join(', ')} · Mode : ${entry.mode ?? 'subagents'}`),
      `Agents : ${(entry.agents ?? []).join(', ')}`,
      '',
      `${c.dim('→')} Installer : /byt install ${entry.name}`,
    ].join('\n');
    return { data: { installed: false, ...entry }, text };
  }

  const d = describeInstalled(ctx, found);
  const status = d.enabled ? c.green('● active') : c.yellow('○ inactive');
  const lines = [
    `${c.bold(d.name)} ${c.dim('v' + d.version)}  ${status}  ${c.dim(`[${scopeLabel(d.scope)}${d.source === 'local' ? ', locale' : ''}]`)}`,
    d.description,
    c.dim(`Auteur : ${d.author || '?'} · Tags : ${d.tags.join(', ') || '-'} · Mode : ${d.mode} · Lead : ${d.lead}`),
    '',
    table(
      d.agents.map((a) => [
        a.enabled ? c.green('✔') : c.dim('✖'),
        c.bold(a.name) + (a.lead ? c.dim(' (lead)') : ''),
        c.dim(a.model),
        a.tools.join(', ') || c.yellow('tous les outils'),
      ])
    ),
  ];
  for (const a of d.agents) if (a.description) lines.push(`\n  ${c.cyan(a.name)} : ${a.description}`);
  if (d.mode === 'agent-team' && !d.agentTeamsEnabled) {
    lines.push('', `${c.yellow('attention')}  Mode agent-team : la fonctionnalité expérimentale n'est pas activée (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1).`);
  }
  lines.push('', c.dim(`Dossier : ${d.dir}`));
  return { data: d, text: lines.join('\n') };
}

function runCmd() {
  throw new BytError(
    'RUN_REQUIRES_CLAUDE',
    'La commande run s\'exécute dans Claude Code : elle a besoin du raisonnement de Claude.',
    'Dans Claude Code : /byt run <team> <tâche>. En terminal, « byt info <team> --json » donne la composition de la team.'
  );
}

export const COMMANDS = {
  help,
  version,
  list,
  'list-available': listAvailable,
  search,
  info,
  install,
  uninstall,
  update,
  run: runCmd,
  config,
  validate,
  enable,
  disable,
  use,
  sync,
};
