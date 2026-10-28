import fs from 'node:fs';
import path from 'node:path';
import { errors } from './errors.mjs';

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

// Écriture atomique : on écrit un fichier temporaire puis on le renomme.
export function writeText(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, p);
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
