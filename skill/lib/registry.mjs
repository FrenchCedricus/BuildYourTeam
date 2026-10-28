import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BytError, errors } from './errors.mjs';
import { loadConfig } from './config.mjs';
import { writeText } from './fsutil.mjs';

// Le registry est un dossier (URL http(s), file:// ou chemin local) contenant registry.json
// et les teams aux chemins indiqués dans chaque entrée.
function isHttp(base) {
  return /^https?:\/\//i.test(base);
}

function localRoot(base) {
  return base.startsWith('file://') ? fileURLToPath(base) : path.resolve(base);
}

async function readRemote(base, rel) {
  if (isHttp(base)) {
    const url = `${base.replace(/\/+$/, '')}/${rel}`;
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'buildyourteam' } });
    } catch (e) {
      throw new BytError(
        'REGISTRY_UNREACHABLE',
        `Impossible de joindre le registry (${e.cause?.code ?? e.message}).`,
        `Vérifiez votre connexion, ou l'URL configurée : byt config registry <url>`
      );
    }
    if (!res.ok) throw new BytError('REGISTRY_HTTP', `Téléchargement impossible (HTTP ${res.status}) : ${url}`);
    return res.text();
  }
  const file = path.join(localRoot(base), rel);
  if (!fs.existsSync(file)) throw new BytError('REGISTRY_FILE_MISSING', `Fichier introuvable dans le registry : ${file}`);
  return fs.readFileSync(file, 'utf8');
}

export async function fetchRegistry(ctx) {
  const { registry: base } = loadConfig(ctx);
  const text = await readRemote(base, 'registry.json');
  let reg;
  try {
    reg = JSON.parse(text);
  } catch (e) {
    throw errors.invalidJson('registry.json', e.message);
  }
  if (!reg || !Array.isArray(reg.teams)) {
    throw new BytError('REGISTRY_INVALID', 'Le registry est invalide : la liste « teams » est absente.');
  }
  return { base, teams: reg.teams };
}

export function findEntry(registry, name) {
  return registry.teams.find((t) => t.name === name) ?? null;
}

// Refuse tout chemin qui sortirait du dossier de la team (registry malveillant).
function safeRelative(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some((p) => p === '..' || p === '')) {
    throw new BytError('REGISTRY_UNSAFE_PATH', `Chemin refusé dans le registry : « ${rel} ».`);
  }
  return rel;
}

export async function downloadTeam(registry, entry, destDir) {
  const teamPath = safeRelative(entry.path ?? `teams/${entry.name}`);
  const files = Array.isArray(entry.files) && entry.files.length ? entry.files : ['team.json'];
  for (const rel of files) {
    safeRelative(rel);
    const content = await readRemote(registry.base, `${teamPath}/${rel}`);
    writeText(path.join(destDir, ...rel.split('/')), content);
  }
}

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function searchRegistry(registry, term) {
  const q = normalize(term);
  return registry.teams.filter((t) =>
    [t.name, t.description, ...(t.tags ?? [])].some((field) => normalize(field).includes(q))
  );
}
