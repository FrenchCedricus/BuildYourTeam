import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BytError, errors } from './errors.mjs';
import { loadConfig } from './config.mjs';
import { writeText } from './fsutil.mjs';

// The registry is a folder (https URL, file:// URL or local path) that contains registry.json
// and the teams at the paths given in each entry.
export const MAX_FILE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 20_000;

function isHttp(base) {
  return /^https?:\/\//i.test(base);
}

function localRoot(base) {
  return base.startsWith('file://') ? fileURLToPath(base) : path.resolve(base);
}

function tooLarge(what) {
  return new BytError('REGISTRY_FILE_TOO_LARGE', `File too large in the registry (over ${MAX_FILE_BYTES / 1024} KiB): ${what}`);
}

async function readRemote(base, rel) {
  if (isHttp(base)) {
    // Plain HTTP: the content (agent prompts) could be modified in transit.
    if (!/^https:\/\//i.test(base)) {
      throw new BytError('REGISTRY_INSECURE', `Registry refused: "${base}" does not use HTTPS.`, 'Use an https:// URL, a local path or a file:// URL.');
    }
    const url = `${base.replace(/\/+$/, '')}/${rel}`;
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'buildyourteam' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new BytError(
        'REGISTRY_UNREACHABLE',
        `Cannot reach the registry (${e.cause?.code ?? e.name ?? e.message}).`,
        `Check your connection, or the configured URL (redirects are refused): byt config registry <url>`
      );
    }
    if (!res.ok) throw new BytError('REGISTRY_HTTP', `Download failed (HTTP ${res.status}): ${url}`);
    if (Number(res.headers.get('content-length')) > MAX_FILE_BYTES) throw tooLarge(url);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw tooLarge(url);
    return text;
  }
  const file = path.join(localRoot(base), rel);
  if (!fs.existsSync(file)) throw new BytError('REGISTRY_FILE_MISSING', `File not found in the registry: ${file}`);
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw tooLarge(file);
  return fs.readFileSync(file, 'utf8');
}

// Hash of a text file, independent of the BOM and line endings (fetch strips the BOM, Windows adds CRLF).
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
    throw new BytError('REGISTRY_INVALID', 'The registry is invalid: the "teams" list is missing.');
  }
  return { base, teams: reg.teams };
}

export function findEntry(registry, name) {
  return registry.teams.find((t) => t.name === name) ?? null;
}

// Refuses any path that would leave the team folder (malicious registry).
function safeRelative(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some((p) => p === '..' || p === '')) {
    throw new BytError('REGISTRY_UNSAFE_PATH', `Path refused in the registry: "${rel}".`);
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
    // Hash published in registry.json: detects a modified or truncated file.
    if (hashes && Object.hasOwn(hashes, rel) && hashes[rel] !== sha256(content)) {
      throw new BytError('REGISTRY_HASH_MISMATCH', `SHA-256 mismatch for ${entry.name}/${rel}: download refused.`, 'The registry may have changed during the download: try again in a few minutes.');
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
