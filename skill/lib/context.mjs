import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { errors } from './errors.mjs';

// Le contexte regroupe tous les chemins : les tests le remplacent par des dossiers temporaires
// via BYT_HOME et BYT_CLAUDE_DIR.
export function createContext({ env = process.env, cwd = process.cwd() } = {}) {
  const home = os.homedir();
  return {
    env,
    cwd: path.resolve(cwd),
    bytHome: path.resolve(env.BYT_HOME || path.join(home, '.byt')),
    claudeDir: path.resolve(env.BYT_CLAUDE_DIR || path.join(home, '.claude')),
  };
}

export function scopePaths(ctx, scope) {
  if (scope === 'project') {
    const root = path.join(ctx.cwd, '.byt');
    return {
      scope,
      root,
      teamsDir: path.join(root, 'teams'),
      statePath: path.join(root, 'state.json'),
      agentsDir: path.join(ctx.cwd, '.claude', 'agents'),
    };
  }
  return {
    scope: 'global',
    root: ctx.bytHome,
    teamsDir: path.join(ctx.bytHome, 'teams'),
    statePath: path.join(ctx.bytHome, 'state.json'),
    agentsDir: path.join(ctx.claudeDir, 'agents'),
  };
}

// Dans le dossier personnel, le mode projet se confondrait avec le mode global.
export function projectScopeAvailable(ctx) {
  return path.join(ctx.cwd, '.byt') !== ctx.bytHome && path.join(ctx.cwd, '.claude') !== ctx.claudeDir;
}

export function availableScopes(ctx) {
  return projectScopeAvailable(ctx) ? ['project', 'global'] : ['global'];
}

// Portée demandée par l'utilisateur, ou portée par défaut de la commande.
export function resolveScope(ctx, flags, defaultScope) {
  if (flags.project && flags.global) throw errors.conflictingScopes();
  if (flags.project) {
    if (!projectScopeAvailable(ctx)) throw errors.projectScopeUnavailable();
    return 'project';
  }
  if (flags.global) return 'global';
  if (defaultScope === 'project' && !projectScopeAvailable(ctx)) return 'global';
  return defaultScope;
}

// Portées à parcourir pour retrouver une team déjà présente.
export function searchScopes(ctx, flags) {
  if (flags.project && flags.global) throw errors.conflictingScopes();
  if (flags.project) return [resolveScope(ctx, flags)];
  if (flags.global) return ['global'];
  return availableScopes(ctx);
}

// Les agent teams sont une fonctionnalité expérimentale activée par variable d'environnement,
// éventuellement déclarée dans un settings.json.
export function agentTeamsEnabled(ctx) {
  const key = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
  const truthy = (v) => v !== undefined && v !== '' && v !== '0' && String(v).toLowerCase() !== 'false';
  if (truthy(ctx.env[key])) return true;
  const files = [
    path.join(ctx.claudeDir, 'settings.json'),
    path.join(ctx.cwd, '.claude', 'settings.json'),
    path.join(ctx.cwd, '.claude', 'settings.local.json'),
  ];
  for (const f of files) {
    try {
      const settings = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (truthy(settings?.env?.[key])) return true;
    } catch {
      // fichier absent ou illisible : on ignore
    }
  }
  return false;
}
