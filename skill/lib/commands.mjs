import path from 'node:path';
import { errors, scopeLabel } from './errors.mjs';
import { availableScopes, scopePaths } from './context.mjs';
import { loadConfig, setConfig, CONFIG_KEYS } from './config.mjs';
import { loadState } from './state.mjs';
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

export const COMMANDS = {
  help,
  version,
  list,
  config,
};
