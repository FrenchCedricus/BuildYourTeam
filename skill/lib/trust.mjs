import path from 'node:path';
import { readJson, writeJson } from './fsutil.mjs';

// Project teams approved by the user. The file lives in ~/.byt, outside the repository,
// so a .byt/ folder shipped in a cloned repository cannot mark itself as trusted.
// { "teams": ["<absolute team folder>", ...] }
function trustPath(ctx) {
  return path.join(ctx.bytHome, 'trust.json');
}

function load(ctx) {
  const data = readJson(trustPath(ctx), {});
  return Array.isArray(data?.teams) ? data.teams.filter((t) => typeof t === 'string') : [];
}

function key(dir) {
  const p = path.resolve(dir);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

// Global teams are installed by the user: always trusted.
export function isTrusted(ctx, scope, dir) {
  if (scope !== 'project') return true;
  return load(ctx).includes(key(dir));
}

export function trustTeam(ctx, dir) {
  const teams = load(ctx);
  if (!teams.includes(key(dir))) {
    teams.push(key(dir));
    writeJson(trustPath(ctx), { teams: teams.sort() });
  }
}
