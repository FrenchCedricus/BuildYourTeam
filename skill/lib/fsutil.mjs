import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BytError, errors } from './errors.mjs';

export function exists(p) {
  return fs.existsSync(p);
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

export function readJson(p, fallback) {
  if (!fs.existsSync(p)) {
    if (fallback !== undefined) return fallback;
    throw errors.invalidJson(p, 'fichier introuvable');
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw errors.invalidJson(p, e.message);
  }
}

// Vérifie qu'un chemin reste dans son dossier de base (données relues sur le disque non fiables).
export function assertInside(base, p) {
  const rel = path.relative(path.resolve(base), path.resolve(p));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new BytError('UNSAFE_PATH', `Chemin refusé : « ${p} » sort de « ${base} ».`);
  }
  return p;
}

// Écriture atomique : on écrit un fichier temporaire au nom imprévisible (créé exclusivement), puis on le renomme.
export function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' });
    fs.renameSync(tmp, p);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function writeJson(p, data) {
  writeText(p, JSON.stringify(data, null, 2) + '\n');
}

export function removeDir(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

export function tempDirIn(parent, label) {
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, `.tmp-${label}-`));
}

// Remplace un dossier par un autre (le dossier source est déplacé).
export function replaceDir(src, dest) {
  removeDir(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}
