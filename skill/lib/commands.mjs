import path from 'node:path';
import { BytError, errors, scopeLabel } from './errors.mjs';
import { availableScopes, scopePaths, searchScopes } from './context.mjs';
import { validateTeam, loadTeam, saveTeam } from './team.mjs';
import { syncScope, formatSync, agentId } from './sync.mjs';
import { loadConfig, setConfig, CONFIG_KEYS } from './config.mjs';
import { loadState, saveState } from './state.mjs';
import { readJson, exists } from './fsutil.mjs';
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

export const COMMANDS = {
  help,
  version,
  list,
  config,
  validate,
  enable,
  disable,
  use,
  sync,
};
