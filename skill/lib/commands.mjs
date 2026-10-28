import path from 'node:path';
import { BytError, errors, scopeLabel } from './errors.mjs';
import { availableScopes, scopePaths, searchScopes, resolveScope, agentTeamsEnabled } from './context.mjs';
import { validateTeam, loadTeam, saveTeam, readAgent, isValidName, assertName, compareVersions } from './team.mjs';
import { isTrusted, trustTeam } from './trust.mjs';
import { splitTools } from './frontmatter.mjs';
import { syncScope, formatSync, agentId } from './sync.mjs';
import { fetchRegistry, findEntry, downloadTeam, searchRegistry } from './registry.mjs';
import { loadConfig, setConfig, CONFIG_KEYS } from './config.mjs';
import { loadState, saveState } from './state.mjs';
import { readJson, exists, removeDir, replaceDir, tempDirIn } from './fsutil.mjs';
import { parseData, createTeam, addAgent, removeAgent } from './builder.mjs';
import { createPrompter, runNewWizard, runAddAgentWizard } from './wizard.mjs';
import { table } from './format.mjs';

export const VERSION = '0.1.0';

// ---------------------------------------------------------------- help

const HELP = [
  ['help [command]', 'Show this help, or the help of one command'],
  ['list', 'Installed teams, with their active and inactive agents'],
  ['list --available', 'Teams available in the registry'],
  ['search <word>', 'Search the registry (name, description, tags)'],
  ['info <team>', 'Details of a team and its agents'],
  ['install <team>', 'Install a team from the registry'],
  ['uninstall <team>', 'Uninstall a team'],
  ['update [team]', 'Update one team, or all of them'],
  ['enable <team> [agent]', 'Enable a team or an agent'],
  ['disable <team> [agent]', 'Disable a team or an agent'],
  ['use <team>', 'Enable a team and sync its agents'],
  ['run <team> <task...>', 'Run the team on a task (in Claude Code)'],
  ['new [team]', 'Create a team (interactive wizard)'],
  ['add-agent <team>', 'Add an agent to a team'],
  ['remove-agent <team> <agent>', 'Remove an agent from a team'],
  ['validate [team|folder]', 'Check a team (--strict: warnings fail too)'],
  ['sync', 'Re-sync the agents into .claude/agents'],
  ['config [key] [value]', 'Show or change the configuration'],
  ['trust <team>', "Approve a team that came with the project's .byt folder"],
];

const OPTIONS = [
  ['--project', 'Act on the current project (./.byt, ./.claude/agents)'],
  ['--global', 'Act on the global scope (~/.byt, ~/.claude/agents)'],
  ['--json', 'JSON output (for scripts and tools)'],
  ['--data <json|->', 'JSON input for new/add-agent ("-" reads stdin)'],
  ['--from <team>', 'Start from an existing team (new)'],
  ['--force', 'Replace an existing team (install, new, update)'],
];

function help(ctx, args = { _: [] }) {
  const { c } = ctx;
  const topic = args._[0];
  if (topic) {
    // "help install": only that command's lines, then the options.
    const rows = HELP.filter(([usage]) => usage.split(' ')[0] === topic);
    if (rows.length) {
      return {
        text: [`${c.bold('BuildYourTeam')} ${c.dim('v' + VERSION)} — help for "${topic}"`, '', table(rows.map(([cmd, desc]) => [c.cyan(cmd), desc])), '', c.bold('Options'), table(OPTIONS.map(([opt, desc]) => [c.cyan(opt), desc]))].join('\n'),
        data: { version: VERSION, commands: rows.map(([usage, description]) => ({ usage, description })), options: OPTIONS.map(([option, description]) => ({ option, description })) },
      };
    }
  }
  const text = [
    `${c.bold('BuildYourTeam')} ${c.dim('v' + VERSION)} — teams of Claude Code subagents`,
    '',
    c.bold('Commands'),
    table(HELP.map(([cmd, desc]) => [c.cyan(cmd), desc])),
    '',
    c.bold('Options'),
    table(OPTIONS.map(([opt, desc]) => [c.cyan(opt), desc])),
    '',
    c.dim('In Claude Code: /byt <command>   ·   In a terminal: node byt.mjs <command>'),
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

// ---------------------------------------------------------------- installed teams

// Lists the teams of a scope as described by state.json and their team.json.
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
      text: `No team installed.\n  ${c.dim('→')} See the available teams: /byt list --available`,
    };
  }

  const lines = [c.bold(`Installed teams (${teams.length})`), ''];
  for (const t of teams) {
    const status = t.enabled ? c.green('● active') : c.yellow('○ inactive');
    const tags = [scopeLabel(t.scope), t.source === 'local' ? 'local' : null, t.mode === 'agent-team' ? 'agent-team' : null]
      .filter(Boolean)
      .join(', ');
    lines.push(`${c.bold(t.name)} ${c.dim('v' + (t.version ?? '?'))}  ${status}  ${c.dim('[' + tags + ']')}`);
    if (t.broken) {
      lines.push(`  ${c.red('team.json not found — reinstall the team')}`);
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
    if (!Object.hasOwn(CONFIG_KEYS, key)) throw errors.usage('config [registry] [value]');
    return { data: { [key]: cfg[key] }, text: String(cfg[key]) };
  }
  const rows = Object.keys(CONFIG_KEYS).map((k) => [c.cyan(k), cfg[k], c.dim(CONFIG_KEYS[k])]);
  return {
    data: { config: cfg, paths: { bytHome: ctx.bytHome, claudeDir: ctx.claudeDir } },
    text: [c.bold('Configuration'), table(rows), '', c.dim(`File: ${path.join(ctx.bytHome, 'config.json')}`)].join('\n'),
  };
}

// ---------------------------------------------------------------- finding an installed team

// Looks for the team in the allowed scopes (project first, then global).
export function findInstalled(ctx, name, flags = {}) {
  if (!isValidName(name)) return null;
  for (const scope of searchScopes(ctx, flags)) {
    const sp = scopePaths(ctx, scope);
    const state = loadState(sp);
    const dir = path.join(sp.teamsDir, name);
    if (Object.hasOwn(state.teams, name) && exists(path.join(dir, 'team.json'))) {
      return { scope, sp, state, dir, info: state.teams[name] };
    }
  }
  return null;
}

export function requireInstalled(ctx, name, flags) {
  if (!name) throw errors.usage('byt <command> <team>');
  const found = findInstalled(ctx, name, flags);
  if (!found) throw errors.teamNotInstalled(name);
  return found;
}

// ---------------------------------------------------------------- validation

function formatValidation(c, label, result) {
  const lines = [];
  const head = result.ok ? c.green('✔') : c.red('✖');
  lines.push(`${head} ${c.bold(label)}${result.ok ? ': valid' : ': invalid'}`);
  for (const e of result.errors) lines.push(`  ${c.red('error')}  ${e}`);
  for (const w of result.warnings) lines.push(`  ${c.yellow('warning')}  ${w}`);
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
  const text = results.length === 0 ? 'No team to validate.' : results.map((r) => formatValidation(c, r.label, r)).join('\n');
  if (!ok) {
    const err = new BytError('VALIDATION_FAILED', strict ? 'Validation failed (strict mode).' : 'Validation failed.');
    err.hint = 'Fix the errors above, then run again: byt validate';
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
      warnings.push(`"${agentName}" is the lead: /byt run will coordinate the team without its lead prompt.`);
    }
    if (enabled && found.info.enabled === false) {
      warnings.push(`Team "${teamName}" is disabled: enable it with /byt enable ${teamName}.`);
    }
    message = `Agent ${c.bold(agentName)} of ${c.bold(teamName)} ${enabled ? 'enabled' : 'disabled'}.`;
  } else {
    found.state.teams[teamName].enabled = enabled;
    saveState(found.sp, found.state);
    message = `Team ${c.bold(teamName)} ${enabled ? 'enabled' : 'disabled'}.`;
  }

  const sync = syncScope(ctx, found.scope);
  const lines = [`${c.green('✔')} ${message}`, ...warnings.map((w) => `  ${c.yellow('warning')}  ${w}`), formatSync(c, sync)];
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

// "use": enables the team and confirms which agents are available in Claude Code.
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
    `${c.green('✔')} Team ${c.bold(teamName)} ready: ${active.length} active agent(s).`,
    ...active.map((a) => `  ${c.cyan(a.subagent)}`),
    formatSync(c, sync),
    '',
    `${c.dim('→')} Run it: /byt run ${teamName} <task>`,
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
    const mark = installed.has(t.name) ? c.green('✔ installed') : '';
    return [c.bold(t.name), c.dim('v' + t.version), t.description, c.dim((t.tags ?? []).join(', ')), mark];
  });
}

async function listAvailable(ctx) {
  const { c } = ctx;
  const registry = await fetchRegistry(ctx);
  const installed = installedNames(ctx);
  const teams = registry.teams.map((t) => ({ ...t, installed: installed.has(t.name), installedIn: installed.get(t.name) ?? [] }));
  const text = teams.length
    ? [c.bold(`Available teams (${teams.length})`), '', table(registryRows(c, teams, installed)), '', `${c.dim('→')} Install: /byt install <team>`].join('\n')
    : 'The registry contains no team.';
  return { data: { registry: registry.base, teams }, text };
}

async function search(ctx, args) {
  const { c } = ctx;
  const term = args._.join(' ').trim();
  if (!term) throw errors.usage('byt search <word>');
  const registry = await fetchRegistry(ctx);
  const installed = installedNames(ctx);
  const results = searchRegistry(registry, term).map((t) => ({ ...t, installed: installed.has(t.name) }));
  const text = results.length
    ? [c.bold(`${results.length} result(s) for "${term}"`), '', table(registryRows(c, results, installed))].join('\n')
    : `No team matches "${term}".\n  ${c.dim('→')} All teams: /byt list --available`;
  return { data: { term, results }, text };
}

// Downloads a team into a temporary folder and validates it before installing it.
async function stageFromRegistry(registry, entry, teamsDir) {
  const tmp = tempDirIn(teamsDir, entry.name);
  try {
    await downloadTeam(registry, entry, tmp);
    const v = validateTeam(tmp, { expectedName: entry.name });
    if (!v.ok) {
      const err = new BytError('TEAM_INVALID', `Registry team "${entry.name}" is invalid, installation cancelled.`);
      err.details = v.errors.map((e) => `  error  ${e}`).join('\n');
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
  if ((Object.hasOwn(state.teams, name) || exists(dest)) && !args.flags.force) throw errors.teamExists(name, scope);

  const registry = await fetchRegistry(ctx);
  const entry = findEntry(registry, name);
  if (!entry) throw errors.teamNotInRegistry(name);
  const { tmp, team } = await stageFromRegistry(registry, entry, sp.teamsDir);
  replaceDir(tmp, dest);

  state.teams[name] = { version: team.version, source: 'registry', enabled: true, installedAt: new Date().toISOString() };
  saveState(sp, state);
  if (scope === 'project') trustTeam(ctx, dest);
  const sync = syncScope(ctx, scope);
  const lines = [
    `${c.green('✔')} Team ${c.bold(name)} ${c.dim('v' + team.version)} installed (${scopeLabel(scope)}): ${team.agents.length} agent(s).`,
    formatSync(c, sync),
    '',
    `${c.dim('→')} Run it: /byt run ${name} <task>`,
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
      `Team "${name}" is local (you created it): uninstalling it deletes it for good.`,
      `Confirm with: byt uninstall ${name} --force`
    );
  }
  removeDir(found.dir);
  delete found.state.teams[name];
  saveState(found.sp, found.state);
  const sync = syncScope(ctx, found.scope);
  return {
    data: { team: name, scope: found.scope, sync },
    text: [`${c.green('✔')} Team ${c.bold(name)} uninstalled (${scopeLabel(found.scope)}).`, formatSync(c, sync)].join('\n'),
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
  if (targets.length === 0) return { data: { results }, text: 'No installed team to update.' };

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
    // The user's enable/disable choices survive the update.
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
    updated: (r) => `${c.green('✔')} ${c.bold(r.team)}: ${r.from} → ${r.version}`,
    'up-to-date': (r) => `${c.dim('=')} ${c.bold(r.team)}: already up to date (${r.version})`,
    local: (r) => `${c.dim('-')} ${c.bold(r.team)}: local team, skipped`,
    'not-in-registry': (r) => `${c.yellow('?')} ${c.bold(r.team)}: not in the registry, skipped`,
  };
  const lines = [...results.map((r) => label[r.status](r)), ...syncs.map((s) => formatSync(c, s))];
  return { data: { results, sync: syncs }, text: lines.join('\n') };
}

// ---------------------------------------------------------------- team details

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
    // A team in the project's .byt folder may come from a cloned repository: it must be approved (byt trust).
    trusted: isTrusted(ctx, found.scope, found.dir),
    // A project team with the same name as a global team hides it.
    shadowsGlobal: found.scope === 'project' && Boolean(findInstalled(ctx, name, { global: true })),
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
      // registry unreachable: just report that the team is not installed
    }
    if (!entry) throw errors.teamNotInstalled(name);
    const text = [
      `${c.bold(entry.name)} ${c.dim('v' + entry.version)}  ${c.yellow('not installed')}`,
      entry.description,
      c.dim(`Author: ${entry.author ?? '?'} · Tags: ${(entry.tags ?? []).join(', ')} · Mode: ${entry.mode ?? 'subagents'}`),
      `Agents: ${(entry.agents ?? []).join(', ')}`,
      '',
      `${c.dim('→')} Install: /byt install ${entry.name}`,
    ].join('\n');
    return { data: { installed: false, ...entry }, text };
  }

  const d = describeInstalled(ctx, found);
  const status = d.enabled ? c.green('● active') : c.yellow('○ inactive');
  const lines = [
    `${c.bold(d.name)} ${c.dim('v' + d.version)}  ${status}  ${c.dim(`[${scopeLabel(d.scope)}${d.source === 'local' ? ', local' : ''}]`)}`,
    d.description,
    c.dim(`Author: ${d.author || '?'} · Tags: ${d.tags.join(', ') || '-'} · Mode: ${d.mode} · Lead: ${d.lead}`),
    '',
    table(
      d.agents.map((a) => [
        a.enabled ? c.green('✔') : c.dim('✖'),
        c.bold(a.name) + (a.lead ? c.dim(' (lead)') : ''),
        c.dim(a.model),
        a.tools.join(', ') || c.yellow('all tools'),
      ])
    ),
  ];
  for (const a of d.agents) if (a.description) lines.push(`\n  ${c.cyan(a.name)}: ${a.description}`);
  if (!d.trusted) {
    lines.push('', `${c.yellow('warning')}  Project team not approved: it comes from this project's .byt folder, not from you. Review its agents, then: byt trust ${d.name}`);
  }
  if (d.shadowsGlobal) {
    lines.push('', `${c.yellow('warning')}  This project team hides your global team "${d.name}".`);
  }
  if (d.mode === 'agent-team' && !d.agentTeamsEnabled) {
    lines.push('', `${c.yellow('warning')}  agent-team mode: the experimental feature is not enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1).`);
  }
  lines.push('', c.dim(`Folder: ${d.dir}`));
  return { data: d, text: lines.join('\n') };
}

// ---------------------------------------------------------------- team creation

function readStdin(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (d) => chunks.push(Buffer.from(d)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
    stream.resume?.();
  });
}

async function readData(ctx, args) {
  const raw = args.flags.data === '-' ? await readStdin(ctx.io.stdin) : args.flags.data;
  return parseData(raw, args.flags.data === '-' ? 'stdin' : '--data');
}

function requireInteractive(ctx, args, usage) {
  if (args.flags.json) {
    throw new BytError('DATA_REQUIRED', 'With --json, the input must be given with --data.', `Usage: ${usage}`);
  }
}

// Resolves a starting team: installed, otherwise downloaded from the registry.
async function resolveBase(ctx, name, scope, cache) {
  if (cache.has(name)) return cache.get(name);
  const found = findInstalled(ctx, name);
  let base;
  if (found) {
    base = { dir: found.dir, team: loadTeam(found.dir), cleanup: () => {} };
  } else {
    let registry;
    try {
      registry = await fetchRegistry(ctx);
    } catch {
      throw errors.teamNotInstalled(name);
    }
    const entry = findEntry(registry, name);
    if (!entry) throw errors.teamNotInRegistry(name);
    const { tmp, team } = await stageFromRegistry(registry, entry, scopePaths(ctx, scope).teamsDir);
    base = { dir: tmp, team, cleanup: () => removeDir(tmp) };
  }
  cache.set(name, base);
  return base;
}

async function wizardSources(ctx) {
  const installed = installedNames(ctx);
  const sources = [...installed.keys()].map((name) => ({ name, label: `${name} ${ctx.c.dim('(installed)')}` }));
  try {
    const registry = await fetchRegistry(ctx);
    for (const t of registry.teams) {
      if (!installed.has(t.name)) sources.push({ name: t.name, label: `${t.name} ${ctx.c.dim('(registry) — ' + t.description)}` });
    }
  } catch {
    // registry unreachable: only offer the installed teams
  }
  return sources;
}

function formatAgents(c, agents) {
  return table(
    agents.map((a) => [
      c.bold(a.name) + (a.lead ? c.dim(' (lead)') : ''),
      a.role,
      c.dim(a.tools.join(', ')),
      a.model,
    ])
  );
}

async function newTeam(ctx, args) {
  const { c } = ctx;
  const usage = 'byt new [team] --data \'<json>\' [--from <team>] [--global]';
  const scope = resolveScope(ctx, args.flags, 'project');
  const cache = new Map();
  let data;
  let fromName = args.flags.from;
  if (fromName !== undefined) assertName('team', fromName);

  try {
    if (args.flags.data !== undefined) {
      data = await readData(ctx, args);
      if (args._[0]) data.name = args._[0];
      fromName = fromName ?? data.from;
      if (fromName !== undefined) assertName('team', fromName);
    } else {
      requireInteractive(ctx, args, usage);
      const prompter = createPrompter(ctx.io.stdin, ctx.io.stdout);
      let result;
      try {
        const sources = fromName ? [] : await wizardSources(ctx);
        result = await runNewWizard({
          prompter,
          c,
          name: args._[0],
          sources,
          loadSource: async (n) => {
            const base = await resolveBase(ctx, n, scope, cache);
            return {
              team: base.team,
              agents: base.team.agents.map((a) => ({ name: a.name, ...(readAgent(base.dir, a.name)?.frontmatter ?? {}) })),
            };
          },
        });
      } finally {
        prompter.close();
      }
      if (!result) return { data: { cancelled: true }, text: 'Creation cancelled: no file written.' };
      data = result.data;
      fromName = result.from ?? fromName;
    }

    const base = fromName ? await resolveBase(ctx, fromName, scope, cache) : null;
    const r = createTeam(ctx, data, { scope, base, force: Boolean(args.flags.force) });
    const lines = [
      `${c.green('✔')} Team ${c.bold(r.team)} ${c.dim('v' + r.version)} created (${scopeLabel(r.scope)}, local${r.from ? `, from ${r.from}` : ''}).`,
      '',
      formatAgents(c, r.agents),
      '',
      `${c.green('✔')} validate: team is valid`,
      ...r.validation.warnings.map((w) => `  ${c.yellow('warning')}  ${w}`),
      formatSync(c, r.sync),
      '',
      `${c.dim('→')} Enable: /byt use ${r.team}`,
      `${c.dim('→')} Run:    /byt run ${r.team} <task>`,
      c.dim(`Edit the prompts in ${path.join(r.dir, 'agents')}`),
    ];
    return { data: { ...r, next: [`/byt use ${r.team}`, `/byt run ${r.team} <task>`] }, text: lines.join('\n') };
  } finally {
    for (const base of cache.values()) base.cleanup();
  }
}

async function addAgentCmd(ctx, args) {
  const { c } = ctx;
  const usage = 'byt add-agent <team> --data \'{"name":"...","role":"...","access":"read|write|exec","model":"sonnet"}\'';
  let spec;
  let teamName = args._[0];
  if (args.flags.data !== undefined) {
    spec = await readData(ctx, args);
    teamName = teamName ?? spec.team;
    delete spec.team;
  }
  if (!teamName) throw errors.usage(usage);
  const found = requireInstalled(ctx, teamName, args.flags);
  if (!spec) {
    requireInteractive(ctx, args, usage);
    const prompter = createPrompter(ctx.io.stdin, ctx.io.stdout, `In non-interactive mode, provide the input: ${usage}`);
    try {
      spec = await runAddAgentWizard({ prompter, c, team: teamName });
    } finally {
      prompter.close();
    }
  }
  const r = addAgent(ctx, found, spec);
  const warnings = [...r.validation.warnings];
  if (found.info.source !== 'local') {
    warnings.push(`Team "${teamName}" comes from the registry: an update will overwrite this addition. To customise it for good: byt new my-team --from ${teamName}`);
  }
  const lines = [
    `${c.green('✔')} Agent ${c.bold(r.agent.name)} added to ${c.bold(teamName)}.`,
    formatAgents(c, [r.agent]),
    ...warnings.map((w) => `  ${c.yellow('warning')}  ${w}`),
    formatSync(c, r.sync),
  ];
  return { data: { ...r, warnings }, text: lines.join('\n') };
}

function removeAgentCmd(ctx, args) {
  const { c } = ctx;
  const [teamName, agentName] = args._;
  if (!teamName || !agentName) throw errors.usage('byt remove-agent <team> <agent>');
  const found = requireInstalled(ctx, teamName, args.flags);
  const r = removeAgent(ctx, found, agentName);
  return {
    data: r,
    text: [`${c.green('✔')} Agent ${c.bold(agentName)} removed from ${c.bold(teamName)}.`, formatSync(c, r.sync)].join('\n'),
  };
}

function trust(ctx, args) {
  const { c } = ctx;
  const name = args._[0];
  if (!name) throw errors.usage('byt trust <team>');
  const found = requireInstalled(ctx, name, args.flags);
  if (found.scope !== 'project') {
    return { data: { team: name, scope: found.scope, trusted: true }, text: `${c.dim('=')} Team ${c.bold(name)} is global: already approved.` };
  }
  const v = validateTeam(found.dir, { expectedName: name });
  if (!v.ok) {
    const err = new BytError('TEAM_INVALID', `Team "${name}" is invalid: it cannot be approved.`);
    err.details = v.errors.map((e) => `  error  ${e}`).join('\n');
    throw err;
  }
  trustTeam(ctx, found.dir);
  return { data: { team: name, scope: found.scope, dir: found.dir, trusted: true }, text: `${c.green('✔')} Team ${c.bold(name)} from the project approved.` };
}

function runCmd() {
  throw new BytError(
    'RUN_REQUIRES_CLAUDE',
    'The run command works inside Claude Code: it needs Claude\'s reasoning.',
    'In Claude Code: /byt run <team> <task>. In a terminal, "byt info <team> --json" shows the team\'s composition.'
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
  new: newTeam,
  'add-agent': addAgentCmd,
  'remove-agent': removeAgentCmd,
  config,
  validate,
  enable,
  disable,
  use,
  sync,
  trust,
};
