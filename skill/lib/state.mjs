import { readJson, writeJson } from './fsutil.mjs';

// state.json, one per scope:
// {
//   "teams": { "<team>": { "version", "source": "registry" | "local", "enabled", "installedAt" } },
//   "synced": ["byt-<team>-<agent>.md", ...]   // files written by BYT in .claude/agents
// }
export function loadState(sp) {
  const raw = readJson(sp.statePath, {});
  const state = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // Prototype-free object: a team named "constructor" or "toString" must not look installed.
  const teams = Object.assign(Object.create(null), state.teams && typeof state.teams === 'object' ? state.teams : {});
  return { ...state, teams, synced: Array.isArray(state.synced) ? state.synced : [] };
}

export function saveState(sp, state) {
  writeJson(sp.statePath, state);
}
