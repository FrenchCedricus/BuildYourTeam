import readline from 'node:readline';
import { BytError } from './errors.mjs';
import { isValidName } from './team.mjs';
import { table } from './format.mjs';
import { ACCESS_LEVELS, MODEL_CHOICES, PROJECT_TYPES, defaultsFor, isLeadName, accessFromTools } from './roles.mjs';
import { splitTools } from './frontmatter.mjs';

// Queue-based line reader: works in a TTY as well as with piped input (tests).
export function createPrompter(input, output, abortHint = 'In non-interactive mode, provide the input: byt new --data \'<json>\'') {
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
          'Wizard interrupted (end of input).',
          abortHint
        );
      }
      return line.trim();
    },
    close: () => rl.close(),
  };
}

// Question helpers: every question has a default value (Enter).
function helpers(p, c) {
  async function text(label, { def, validate, optional = false } = {}) {
    for (;;) {
      const suffix = def ? c.dim(` [${def}]`) : '';
      const answer = (await p.ask(`${c.cyan('?')} ${label}${suffix} : `)) || def || '';
      if (!answer && optional) return '';
      if (!answer) {
        p.write(`  ${c.yellow('An answer is required.')}\n`);
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
    options.forEach((o, i) => p.write(`  ${c.bold(String(i + 1))}. ${o.label}${i === defIndex ? c.dim(' (recommended)') : ''}\n`));
    for (;;) {
      const answer = await p.ask(`  Your choice ${c.dim(`[${defIndex + 1}]`)}: `);
      if (!answer) return options[defIndex].value;
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
      p.write(`  ${c.yellow(`Enter a number between 1 and ${options.length}.`)}\n`);
    }
  }

  async function multi(label, options) {
    p.write(`${c.cyan('?')} ${label}\n`);
    options.forEach((o, i) => p.write(`  ${c.green('✔')} ${c.bold(String(i + 1))}. ${o.label}\n`));
    for (;;) {
      const answer = await p.ask(`  Numbers to keep, separated by commas ${c.dim('[all]')}: `);
      if (!answer) return options.map((o) => o.value);
      const nums = answer.split(/[\s,;]+/).filter(Boolean).map(Number);
      if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length)) {
        return [...new Set(nums)].sort((a, b) => a - b).map((n) => options[n - 1].value);
      }
      p.write(`  ${c.yellow(`Enter numbers between 1 and ${options.length}.`)}\n`);
    }
  }

  return { text, choice, multi };
}

const nameProblem = (v) => (isValidName(v) ? null : 'Invalid name: use kebab-case (e.g. "my-agent").');

const accessOptions = Object.entries(ACCESS_LEVELS).map(([value, a]) => ({ value, label: `${a.label} ${'(' + a.tools.join(', ') + ')'}` }));
const modelOptions = MODEL_CHOICES.map((m) => ({ value: m.id, label: m.label }));

// Runs the 8 steps and returns { data, from } ready for createTeam, or null if cancelled.
// `sources`: [{ name, label }]; `loadSource(name)` → { team, agents: [{ name, description, tools, model }] }.
export async function runNewWizard({ prompter: p, c, name, sources = [], loadSource }) {
  const ask = helpers(p, c);
  p.write(`\n${c.bold('New team')} ${c.dim('— press Enter to accept the suggested value')}\n\n`);

  // 1. Name and goal
  const teamName = name && isValidName(name) ? name : await ask.text('Team name (kebab-case)', { validate: nameProblem });
  const description = await ask.text('Team goal, in one sentence');

  // 2. Starting point
  let from = null;
  let sourceLead = null;
  let agents;
  if (sources.length) {
    from = await ask.choice('Starting point', [{ value: null, label: 'Start from scratch' }, ...sources.map((s) => ({ value: s.name, label: s.label }))], 0);
  }

  if (from) {
    const src = await loadSource(from);
    sourceLead = src.team.lead;
    agents = src.agents.map((a) => {
      const tools = splitTools(a.tools);
      return { name: a.name, role: a.description, access: accessFromTools(tools), model: a.model ?? 'sonnet', origin: 'source', changed: {} };
    });
  } else {
    // 3. Project type → suggested composition
    const type = await ask.choice(
      'Project type',
      Object.entries(PROJECT_TYPES).map(([value, t]) => ({ value, label: t.label })),
      0
    );
    agents = PROJECT_TYPES[type].agents.map((n) => ({ name: n, ...defaultsFor(n), origin: 'new' }));
  }

  // 4. Composition
  const kept = await ask.multi(
    'Suggested composition',
    agents.map((a) => ({ value: a.name, label: `${c.bold(a.name)} ${c.dim('— ' + a.role)}` }))
  );
  agents = agents.filter((a) => kept.includes(a.name));
  const extra = await ask.text('Roles to add (names separated by commas)', { optional: true, def: '' });
  for (const n of extra.split(/[\s,;]+/).filter(Boolean)) {
    if (!isValidName(n)) {
      p.write(`  ${c.yellow(`"${n}" skipped: invalid name (kebab-case expected).`)}\n`);
      continue;
    }
    if (agents.some((a) => a.name === n)) continue;
    const d = defaultsFor(n);
    const role = await ask.text(`Role of "${n}" in one sentence`, { def: d.role });
    agents.push({ name: n, ...d, role, origin: 'new' });
  }
  if (agents.length === 0) {
    p.write(`  ${c.yellow('No agent kept: adding a "lead" agent.')}\n`);
    agents.push({ name: 'lead', ...defaultsFor('lead'), origin: 'new' });
  }
  const lead = agents.find((a) => a.name === sourceLead)?.name ?? agents.find((a) => isLeadName(a.name))?.name ?? agents[0].name;

  // 5 and 6. Access and model: recommended values in one step, or set agent by agent.
  const custom = await ask.choice(
    'Access level and model of each agent',
    [
      { value: false, label: 'Use the recommended settings' },
      { value: true, label: 'Choose for each agent' },
    ],
    0
  );
  if (custom) {
    for (const a of agents) await editAccessAndModel(ask, c, a);
  }

  // 7. Mode
  const mode = await ask.choice(
    'Execution mode',
    [
      { value: 'subagents', label: 'Subagents (the lead delegates to subagents)' },
      { value: 'agent-team', label: 'Agent team (experimental: agents work with each other)' },
    ],
    0
  );

  // 8. Recap
  for (;;) {
    p.write(`\n${c.bold(`Recap: ${teamName}`)} ${c.dim(`(${mode}, lead: ${lead})`)}\n`);
    p.write(table(agents.map((a, i) => [String(i + 1) + '.', c.bold(a.name), a.role, c.dim(ACCESS_LEVELS[a.access].tools.join(', ')), a.model])) + '\n\n');
    const action = await ask.choice(
      'What next?',
      [
        { value: 'ok', label: 'Confirm and create the team' },
        { value: 'edit', label: 'Modify an agent' },
        { value: 'cancel', label: 'Cancel' },
      ],
      0
    );
    if (action === 'cancel') return null;
    if (action === 'ok') break;
    const target = await ask.choice('Agent to modify', agents.map((a) => ({ value: a, label: a.name })), 0);
    const role = await ask.text(`Role of "${target.name}"`, { def: target.role });
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
  const access = await ask.choice(`Access for ${c.bold(a.name)}`, accessOptions, accessIdx);
  const found = MODEL_CHOICES.findIndex((m) => m.id === a.model);
  const modelIdx = found === -1 ? 1 : found;
  const model = await ask.choice(`Model for ${c.bold(a.name)}`, modelOptions, modelIdx);
  if (a.changed) {
    if (access !== a.access) a.changed.access = true;
    if (model !== a.model) a.changed.model = true;
  }
  a.access = access;
  a.model = model;
}

// An agent taken from an existing team keeps its file, except what the user changed.
function toSpec(a) {
  if (a.origin !== 'source') return { name: a.name, role: a.role, access: a.access, model: a.model };
  const spec = { name: a.name };
  if (a.changed.role) spec.role = a.role;
  if (a.changed.access || a.changed.role) spec.access = a.access;
  if (a.changed.model || a.changed.role) spec.model = a.model;
  return spec;
}

// Short wizard for add-agent in the CLI.
export async function runAddAgentWizard({ prompter: p, c, team }) {
  const ask = helpers(p, c);
  p.write(`\n${c.bold(`New agent for ${team}`)} ${c.dim('— press Enter to accept the suggested value')}\n\n`);
  const name = await ask.text('Agent name (kebab-case)', { validate: nameProblem });
  const d = defaultsFor(name);
  const role = await ask.text('Role in one sentence', { def: d.role });
  const a = { name, role, access: d.access, model: d.model };
  await editAccessAndModel(ask, c, a);
  return { name, role, access: a.access, model: a.model };
}
