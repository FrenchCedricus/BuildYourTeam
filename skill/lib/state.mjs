import { readJson, writeJson } from './fsutil.mjs';

// state.json, un par portée :
// {
//   "teams": { "<team>": { "version", "source": "registry" | "local", "enabled", "installedAt" } },
//   "synced": ["byt-<team>-<agent>.md", ...]   // fichiers écrits par BYT dans .claude/agents
// }
export function loadState(sp) {
  const state = readJson(sp.statePath, {});
  return { teams: {}, synced: [], ...state };
}

export function saveState(sp, state) {
  writeJson(sp.statePath, state);
}
