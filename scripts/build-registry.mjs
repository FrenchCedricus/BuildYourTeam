#!/usr/bin/env node
// Valide toutes les teams du dossier teams/ et régénère registry.json.
//   node scripts/build-registry.mjs                 valide puis écrit registry.json
//   node scripts/build-registry.mjs --validate-only valide sans rien écrire
//   node scripts/build-registry.mjs --check         échoue si registry.json n'est pas à jour
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTeam, teamFiles } from '../skill/lib/team.mjs';

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
    // Pour le registry public, les avertissements sont bloquants.
    const ok = r.ok && r.warnings.length === 0;
    results.push({ name, ok, errors: r.errors, warnings: r.warnings });
    if (ok) {
      const t = r.team;
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
        files: teamFiles(t),
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
    for (const e of r.errors) console.log(`    erreur     ${e}`);
    for (const w of r.warnings) console.log(`    attention  ${w}`);
    if (!r.ok) failed = true;
  }
  if (failed) {
    console.error('\n✖ Validation échouée : corrigez les teams ci-dessus.');
    process.exit(1);
  }
  const content = JSON.stringify(registry, null, 2) + '\n';
  if (args.has('--check')) {
    const current = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== content) {
      console.error('\n✖ registry.json n\'est pas à jour : lancez « npm run build:registry ».');
      process.exit(1);
    }
    console.log('\n✔ registry.json est à jour.');
  } else if (!args.has('--validate-only')) {
    fs.writeFileSync(registryPath, content);
    console.log(`\n✔ registry.json généré (${registry.teams.length} teams).`);
  } else {
    console.log(`\n✔ ${results.length} teams valides.`);
  }
}
