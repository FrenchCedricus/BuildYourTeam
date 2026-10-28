import { readJson, writeJson } from './fsutil.mjs';

// state.json, un par portée :
// {
//   "teams": { "<team>": { "version", "source": "registry" | "local", "enabled", "installedAt" } },
//   "synced": ["byt-<team>-<agent>.md", ...]   // fichiers écrits par BYT dans .claude/agents
// }
export function loadState(sp) {
  const raw = readJson(sp.statePath, {});
  const state = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // Objet sans prototype : une team nommée « constructor » ou « toString » ne doit pas sembler installée.
  const teams = Object.assign(Object.create(null), state.teams && typeof state.teams === 'object' ? state.teams : {});
  return { ...state, teams, synced: Array.isArray(state.synced) ? state.synced : [] };
}

export function saveState(sp, state) {
  writeJson(sp.statePath, state);
}
