// Domain errors: a stable code (for --json), a message and a hint towards a fix.
export class BytError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.name = 'BytError';
    this.code = code;
    this.hint = hint;
  }
}

export const errors = {
  usage: (usage) => new BytError('USAGE', 'Missing or invalid arguments.', `Usage: ${usage}`),
  unknownCommand: (cmd) =>
    new BytError('UNKNOWN_COMMAND', `Unknown command: "${cmd}".`, 'Type "byt help" to see the available commands.'),
  teamNotInstalled: (name) =>
    new BytError('TEAM_NOT_INSTALLED', `Team "${name}" is not installed.`, `Install it with: /byt install ${name}`),
  teamNotInRegistry: (name) =>
    new BytError('TEAM_NOT_IN_REGISTRY', `Team "${name}" was not found in the registry.`, 'Search for a team with: /byt search <word>'),
  teamExists: (name, scope) =>
    new BytError(
      'TEAM_EXISTS',
      `Team "${name}" already exists (${scopeLabel(scope)}).`,
      `Use /byt update ${name}, or add --force to replace it.`
    ),
  agentNotFound: (team, agent) =>
    new BytError('AGENT_NOT_FOUND', `Agent "${agent}" does not exist in team "${team}".`, `See its agents: /byt info ${team}`),
  invalidName: (kind, name) =>
    new BytError(
      'INVALID_NAME',
      `Invalid ${kind} name: "${name}".`,
      'Use kebab-case: lowercase letters, digits and hyphens (e.g. "my-agent").'
    ),
  invalidJson: (what, detail) => new BytError('INVALID_JSON', `Invalid JSON (${what}): ${detail}`),
  conflictingScopes: () =>
    new BytError('CONFLICTING_SCOPES', 'The --project and --global options cannot be used together.'),
  projectScopeUnavailable: () =>
    new BytError(
      'PROJECT_SCOPE_UNAVAILABLE',
      'Project scope is unavailable: the current folder is your home folder.',
      'Move to a project folder, or use --global.'
    ),
};

export function scopeLabel(scope) {
  return scope === 'project' ? 'project' : 'global';
}
