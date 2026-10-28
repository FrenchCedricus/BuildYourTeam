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
    throw errors.invalidJson(p, 'file not found');
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw errors.invalidJson(p, e.message);
  }
}

// Checks that a path stays inside its base folder (data read back from disk is untrusted).
export function assertInside(base, p) {
  const rel = path.relative(path.resolve(base), path.resolve(p));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new BytError('UNSAFE_PATH', `Path refused: "${p}" is outside "${base}".`);
  }
  return p;
}

// Atomic write: write a temporary file with an unpredictable name (created exclusively), then rename it.
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

// Replaces a folder with another one (the source folder is moved).
export function replaceDir(src, dest) {
  removeDir(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}
