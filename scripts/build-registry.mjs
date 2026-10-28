#!/usr/bin/env node
// Validates every team in teams/ and regenerates registry.json.
//   node scripts/build-registry.mjs                 validate, then write registry.json
//   node scripts/build-registry.mjs --validate-only validate without writing anything
//   node scripts/build-registry.mjs --check         fail if registry.json is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTeam, teamFiles } from '../skill/lib/team.mjs';
import { sha256 } from '../skill/lib/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const teamsDir = path.join(root, 'teams');
const registryPath = path.join(root, 'registry.json');

export function buildRegistry(teamsRoot) {
  const results = [];
  const teams = [];
  const names = fs.existsSync(teamsRoot)
    ? fs.readdirSync(teamsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  for (const name of names) {
    const dir = path.join(teamsRoot, name);
    const r = validateTeam(dir);
    // For the public registry, warnings are blocking.
    const ok = r.ok && r.warnings.length === 0;
    results.push({ name, ok, errors: r.errors, warnings: r.warnings });
    if (ok) {
      const t = r.team;
      const files = teamFiles(t);
      teams.push({
        name: t.name,
        version: t.version,
        description: t.description,
        author: t.author,
        tags: t.tags ?? [],
        mode: t.mode ?? 'subagents',
        lead: t.lead,
        agents: t.agents.map((a) => a.name),
        path: `teams/${name}`,
        files,
        // Checked by byt install / update: a file that differs from the published one is refused.
        sha256: Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(dir, ...f.split('/')), 'utf8'))])),
      });
    }
  }
  return { results, registry: { schema: 1, teams } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { results, registry } = buildRegistry(teamsDir);
  let failed = false;
  for (const r of results) {
    console.log(`${r.ok ? '✔' : '✖'} ${r.name}`);
    for (const e of r.errors) console.log(`    error    ${e}`);
    for (const w of r.warnings) console.log(`    warning  ${w}`);
    if (!r.ok) failed = true;
  }
  if (failed) {
    console.error('\n✖ Validation failed: fix the teams above.');
    process.exit(1);
  }
  const content = JSON.stringify(registry, null, 2) + '\n';
  if (args.has('--check')) {
    const current = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== content) {
      console.error('\n✖ registry.json is out of date: run "npm run build:registry".');
      process.exit(1);
    }
    console.log('\n✔ registry.json is up to date.');
  } else if (!args.has('--validate-only')) {
    fs.writeFileSync(registryPath, content);
    console.log(`\n✔ registry.json generated (${registry.teams.length} teams).`);
  } else {
    console.log(`\n✔ ${results.length} valid teams.`);
  }
}
