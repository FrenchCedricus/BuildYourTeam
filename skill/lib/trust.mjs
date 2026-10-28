import path from 'node:path';
import { readJson, writeJson } from './fsutil.mjs';

// Teams de projet approuvées par l'utilisateur. Le fichier vit dans ~/.byt, hors du dépôt :
// un .byt/ livré dans un dépôt cloné ne peut donc pas se déclarer lui-même digne de confiance.
// { "teams": ["<dossier absolu de la team>", ...] }
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

// Les teams globales sont installées par l'utilisateur lui-même : toujours approuvées.
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
