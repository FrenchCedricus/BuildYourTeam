import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BytError, errors } from './errors.mjs';
import { loadConfig } from './config.mjs';
import { writeText } from './fsutil.mjs';

// Le registry est un dossier (URL http(s), file:// ou chemin local) contenant registry.json
// et les teams aux chemins indiqués dans chaque entrée.
export const MAX_FILE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 20_000;

function isHttp(base) {
  return /^https?:\/\//i.test(base);
}

function localRoot(base) {
  return base.startsWith('file://') ? fileURLToPath(base) : path.resolve(base);
}

function tooLarge(what) {
  return new BytError('REGISTRY_FILE_TOO_LARGE', `Fichier trop volumineux dans le registry (plus de ${MAX_FILE_BYTES / 1024} Kio) : ${what}`);
}

async function readRemote(base, rel) {
  if (isHttp(base)) {
    // HTTP en clair : le contenu (des prompts d'agents) pourrait être modifié en chemin.
    if (!/^https:\/\//i.test(base)) {
      throw new BytError('REGISTRY_INSECURE', `Registry refusé : « ${base} » n'utilise pas HTTPS.`, 'Utilisez une URL https://, un chemin local ou file://.');
    }
    const url = `${base.replace(/\/+$/, '')}/${rel}`;
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'buildyourteam' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new BytError(
        'REGISTRY_UNREACHABLE',
        `Impossible de joindre le registry (${e.cause?.code ?? e.name ?? e.message}).`,
        `Vérifiez votre connexion, ou l'URL configurée (les redirections sont refusées) : byt config registry <url>`
      );
    }
    if (!res.ok) throw new BytError('REGISTRY_HTTP', `Téléchargement impossible (HTTP ${res.status}) : ${url}`);
    if (Number(res.headers.get('content-length')) > MAX_FILE_BYTES) throw tooLarge(url);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw tooLarge(url);
    return text;
  }
  const file = path.join(localRoot(base), rel);
  if (!fs.existsSync(file)) throw new BytError('REGISTRY_FILE_MISSING', `Fichier introuvable dans le registry : ${file}`);
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw tooLarge(file);
  return fs.readFileSync(file, 'utf8');
}

// Empreinte d'un fichier texte, indépendante du BOM et des fins de ligne (fetch retire le BOM, Windows ajoute des CRLF).
const BOM = String.fromCharCode(0xfeff);
export function sha256(text) {
  const normalized = (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
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
  const hashes = entry.sha256 && typeof entry.sha256 === 'object' ? entry.sha256 : null;
  for (const rel of files) {
    safeRelative(rel);
    const content = await readRemote(registry.base, `${teamPath}/${rel}`);
    // Empreinte publiée dans registry.json : détecte un fichier modifié ou incomplet.
    if (hashes && Object.hasOwn(hashes, rel) && hashes[rel] !== sha256(content)) {
      throw new BytError('REGISTRY_HASH_MISMATCH', `Empreinte sha256 différente pour ${entry.name}/${rel} : téléchargement refusé.`, 'Le registry a peut-être changé pendant le téléchargement : réessayez dans quelques minutes.');
    }
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
