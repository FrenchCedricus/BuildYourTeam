#!/usr/bin/env node
// Runs node --test on test/*.test.mjs. Glob patterns for --test only exist from Node 21,
// so the files are passed explicitly, which works with Node 18 and later.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(testDir, f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
