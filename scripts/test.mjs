#!/usr/bin/env node
// Lance node --test sur test/*.test.mjs. Les motifs glob de --test n'existent qu'à partir de Node 21 :
// on passe donc la liste explicite des fichiers, ce qui marche avec Node 18 et plus.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(testDir, f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
