import readline from 'node:readline';
import { BytError } from './errors.mjs';
import { isValidName } from './team.mjs';
import { table } from './format.mjs';
import { ACCESS_LEVELS, MODEL_CHOICES, PROJECT_TYPES, defaultsFor, isLeadName, accessFromTools } from './roles.mjs';
import { splitTools } from './frontmatter.mjs';

// Lecteur de lignes basé sur une file : fonctionne en TTY comme avec une entrée pipée (tests).
export function createPrompter(input, output, abortHint = 'En mode non interactif, fournissez les données : byt new --data \'<json>\'') {
  const rl = readline.createInterface({ input, terminal: false });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  const next = () => {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };
  return {
    write: (s) => output.write(s),
    async ask(question) {
      output.write(question);
      const line = await next();
      if (line === null) {
        output.write('\n');
        throw new BytError(
          'WIZARD_ABORTED',
          'Assistant interrompu (fin de saisie).',
          abortHint
        );
      }
      return line.trim();
    },
    close: () => rl.close(),
  };
}

// Helpers de questions : chaque question a une valeur par défaut (Entrée).
function helpers(p, c) {
  async function text(label, { def, validate, optional = false } = {}) {
    for (;;) {
      const suffix = def ? c.dim(` [${def}]`) : '';
      const answer = (await p.ask(`${c.cyan('?')} ${label}${suffix} : `)) || def || '';
      if (!answer && optional) return '';
      if (!answer) {
        p.write(`  ${c.yellow('Une réponse est nécessaire.')}\n`);
        continue;
      }
      const problem = validate?.(answer);
      if (problem) {
        p.write(`  ${c.yellow(problem)}\n`);
        continue;
      }
      return answer;
    }
  }

  async function choice(label, options, defIndex = 0) {
    p.write(`${c.cyan('?')} ${label}\n`);
    options.forEach((o, i) => p.write(`  ${c.bold(String(i + 1))}. ${o.label}${i === defIndex ? c.dim(' (recommandé)') : ''}\n`));
    for (;;) {
      const answer = await p.ask(`  Votre choix ${c.dim(`[${defIndex + 1}]`)} : `);
      if (!answer) return options[defIndex].value;
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
      p.write(`  ${c.yellow(`Entrez un numéro entre 1 et ${options.length}.`)}\n`);
    }
  }

  async function multi(label, options) {
    p.write(`${c.cyan('?')} ${label}\n`);
    options.forEach((o, i) => p.write(`  ${c.green('✔')} ${c.bold(String(i + 1))}. ${o.label}\n`));
    for (;;) {
      const answer = await p.ask(`  Numéros à garder, séparés par des virgules ${c.dim('[tous]')} : `);
      if (!answer) return options.map((o) => o.value);
      const nums = answer.split(/[\s,;]+/).filter(Boolean).map(Number);
      if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length)) {
        return [...new Set(nums)].sort((a, b) => a - b).map((n) => options[n - 1].value);
      }
      p.write(`  ${c.yellow(`Entrez des numéros entre 1 et ${options.length}.`)}\n`);
    }
  }

  return { text, choice, multi };
}

const nameProblem = (v) => (isValidName(v) ? null : 'Nom invalide : utilisez le kebab-case (ex. « mon-agent »).');

const accessOptions = Object.entries(ACCESS_LEVELS).map(([value, a]) => ({ value, label: `${a.label} ${'(' + a.tools.join(', ') + ')'}` }));
const modelOptions = MODEL_CHOICES.map((m) => ({ value: m.id, label: m.label }));

// Déroule les 8 étapes et renvoie { data, from } prêts pour createTeam, ou null si annulé.
// `sources` : [{ name, label }] ; `loadSource(name)` → { team, agents: [{ name, description, tools, model }] }.
export async function runNewWizard({ prompter: p, c, name, sources = [], loadSource }) {
  const ask = helpers(p, c);
  p.write(`\n${c.bold('Nouvelle team')} ${c.dim('— Entrée pour accepter la valeur proposée')}\n\n`);

  // 1. Nom et objectif
  const teamName = name && isValidName(name) ? name : await ask.text('Nom de la team (kebab-case)', { validate: nameProblem });
  const description = await ask.text('Objectif de la team, en une phrase');

  // 2. Point de départ
  let from = null;
  let sourceLead = null;
  let agents;
  if (sources.length) {
    from = await ask.choice('Point de départ', [{ value: null, label: 'Partir de zéro' }, ...sources.map((s) => ({ value: s.name, label: s.label }))], 0);
  }

  if (from) {
    const src = await loadSource(from);
    sourceLead = src.team.lead;
    agents = src.agents.map((a) => {
      const tools = splitTools(a.tools);
      return { name: a.name, role: a.description, access: accessFromTools(tools), model: a.model ?? 'sonnet', origin: 'source', changed: {} };
    });
  } else {
    // 3. Type de projet → composition proposée
    const type = await ask.choice(
      'Type de projet',
      Object.entries(PROJECT_TYPES).map(([value, t]) => ({ value, label: t.label })),
      0
    );
    agents = PROJECT_TYPES[type].agents.map((n) => ({ name: n, ...defaultsFor(n), origin: 'new' }));
  }

  // 4. Composition
  const kept = await ask.multi(
    'Composition proposée',
    agents.map((a) => ({ value: a.name, label: `${c.bold(a.name)} ${c.dim('— ' + a.role)}` }))
  );
  agents = agents.filter((a) => kept.includes(a.name));
  const extra = await ask.text('Rôles à ajouter (noms séparés par des virgules)', { optional: true, def: '' });
  for (const n of extra.split(/[\s,;]+/).filter(Boolean)) {
    if (!isValidName(n)) {
      p.write(`  ${c.yellow(`« ${n} » ignoré : nom invalide (kebab-case attendu).`)}\n`);
      continue;
    }
    if (agents.some((a) => a.name === n)) continue;
    const d = defaultsFor(n);
    const role = await ask.text(`Rôle de « ${n} » en une phrase`, { def: d.role });
    agents.push({ name: n, ...d, role, origin: 'new' });
  }
  if (agents.length === 0) {
    p.write(`  ${c.yellow('Aucun agent retenu : ajout d\'un agent « lead ».')}\n`);
    agents.push({ name: 'lead', ...defaultsFor('lead'), origin: 'new' });
  }
  const lead = agents.find((a) => a.name === sourceLead)?.name ?? agents.find((a) => isLeadName(a.name))?.name ?? agents[0].name;

  // 5 et 6. Accès et modèle : valeurs recommandées en un clic, ou réglage agent par agent.
  const custom = await ask.choice(
    'Niveau d\'accès et modèle de chaque agent',
    [
      { value: false, label: 'Utiliser les valeurs recommandées' },
      { value: true, label: 'Choisir pour chaque agent' },
    ],
    0
  );
  if (custom) {
    for (const a of agents) await editAccessAndModel(ask, c, a);
  }

  // 7. Mode
  const mode = await ask.choice(
    'Mode d\'exécution',
    [
      { value: 'subagents', label: 'Subagents (le lead délègue à des subagents)' },
      { value: 'agent-team', label: 'Agent team (expérimental : agents qui collaborent entre eux)' },
    ],
    0
  );

  // 8. Récapitulatif
  for (;;) {
    p.write(`\n${c.bold(`Récapitulatif : ${teamName}`)} ${c.dim(`(${mode}, lead : ${lead})`)}\n`);
    p.write(table(agents.map((a, i) => [String(i + 1) + '.', c.bold(a.name), a.role, c.dim(ACCESS_LEVELS[a.access].tools.join(', ')), a.model])) + '\n\n');
    const action = await ask.choice(
      'Que faire ?',
      [
        { value: 'ok', label: 'Valider et créer la team' },
        { value: 'edit', label: 'Modifier un agent' },
        { value: 'cancel', label: 'Annuler' },
      ],
      0
    );
    if (action === 'cancel') return null;
    if (action === 'ok') break;
    const target = await ask.choice('Agent à modifier', agents.map((a) => ({ value: a, label: a.name })), 0);
    const role = await ask.text(`Rôle de « ${target.name} »`, { def: target.role });
    if (role !== target.role) {
      target.role = role;
      if (target.changed) target.changed.role = true;
    }
    await editAccessAndModel(ask, c, target);
  }

  return {
    from,
    data: {
      name: teamName,
      description,
      mode,
      lead,
      agents: agents.map((a) => toSpec(a)),
    },
  };
}

async function editAccessAndModel(ask, c, a) {
  const accessIdx = Object.keys(ACCESS_LEVELS).indexOf(a.access);
  const access = await ask.choice(`Accès pour ${c.bold(a.name)}`, accessOptions, accessIdx);
  const found = MODEL_CHOICES.findIndex((m) => m.id === a.model);
  const modelIdx = found === -1 ? 1 : found;
  const model = await ask.choice(`Modèle pour ${c.bold(a.name)}`, modelOptions, modelIdx);
  if (a.changed) {
    if (access !== a.access) a.changed.access = true;
    if (model !== a.model) a.changed.model = true;
  }
  a.access = access;
  a.model = model;
}

// Un agent repris d'une team existante garde son fichier, sauf ce que l'utilisateur a changé.
function toSpec(a) {
  if (a.origin !== 'source') return { name: a.name, role: a.role, access: a.access, model: a.model };
  const spec = { name: a.name };
  if (a.changed.role) spec.role = a.role;
  if (a.changed.access || a.changed.role) spec.access = a.access;
  if (a.changed.model || a.changed.role) spec.model = a.model;
  return spec;
}

// Assistant court pour add-agent en CLI.
export async function runAddAgentWizard({ prompter: p, c, team }) {
  const ask = helpers(p, c);
  p.write(`\n${c.bold(`Nouvel agent pour ${team}`)} ${c.dim('— Entrée pour accepter la valeur proposée')}\n\n`);
  const name = await ask.text('Nom de l\'agent (kebab-case)', { validate: nameProblem });
  const d = defaultsFor(name);
  const role = await ask.text('Rôle en une phrase', { def: d.role });
  const a = { name, role, access: d.access, model: d.model };
  await editAccessAndModel(ask, c, a);
  return { name, role, access: a.access, model: a.model };
}
