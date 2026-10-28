// Connaissances partagées par le builder CLI et le skill : niveaux d'accès, modèles,
// compositions types par projet, et prompts de base générés à partir d'un rôle.

export const ACCESS_LEVELS = {
  read: {
    label: 'Lecture seule',
    tools: ['Read', 'Grep', 'Glob'],
    rules: [
      'You are **read-only**: you may read and search the project (Read, Grep, Glob) but you never modify files or run commands.',
      'When a change is needed, describe it precisely (file, location, proposed code or diff) so a teammate with write access can apply it.',
    ],
  },
  write: {
    label: 'Modification de fichiers',
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
    rules: [
      'You may create and edit files (Edit, Write). Keep every change minimal, focused on the task, and consistent with the existing style.',
      'You cannot run commands: list any command that should be run (tests, build, migrations) in your report.',
    ],
  },
  exec: {
    label: 'Exécution de commandes',
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    rules: [
      'You may edit files and run shell commands (Bash). Prefer read-only and reversible commands.',
      'Never delete data, rewrite git history, push, deploy or install global packages unless the task explicitly asks for it.',
      'Run the relevant checks (tests, linter, build) before reporting, and quote the important part of their output.',
    ],
  },
};

const ACCESS_ALIASES = {
  read: 'read', 'read-only': 'read', readonly: 'read', lecture: 'read', 'lecture-seule': 'read',
  write: 'write', edit: 'write', modification: 'write', ecriture: 'write',
  exec: 'exec', bash: 'exec', execute: 'exec', execution: 'exec', commandes: 'exec',
};

export const MODEL_CHOICES = [
  { id: 'haiku', label: 'Rapide / économique (haiku)' },
  { id: 'sonnet', label: 'Équilibré (sonnet)' },
  { id: 'opus', label: 'Puissant (opus)' },
];

const MODEL_ALIASES = {
  haiku: 'haiku', fast: 'haiku', rapide: 'haiku', economique: 'haiku', cheap: 'haiku',
  sonnet: 'sonnet', balanced: 'sonnet', equilibre: 'sonnet', default: 'sonnet',
  opus: 'opus', powerful: 'opus', puissant: 'opus', strong: 'opus',
  inherit: 'inherit',
};

function key(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
}

export function normalizeAccess(value) {
  const v = ACCESS_ALIASES[key(value)];
  if (!v) return null;
  return v;
}

export function normalizeModel(value) {
  const k = key(value);
  if (MODEL_ALIASES[k]) return MODEL_ALIASES[k];
  if (k.startsWith('claude-')) return k;
  return null;
}

// Déduit le niveau d'accès à partir d'une liste d'outils existante.
export function accessFromTools(tools) {
  if (tools.includes('Bash')) return 'exec';
  if (tools.includes('Edit') || tools.includes('Write')) return 'write';
  return 'read';
}

// Profils de rôles : repérés par mot-clé dans le nom de l'agent.
const PROFILES = [
  {
    match: /^(lead|leader|manager|coordinator|orchestrator|facilitator|chef)/,
    role: 'Coordinates the team: breaks the task down, delegates, and assembles the final result',
    access: 'read',
    model: 'opus',
    lead: true,
    focus: [],
  },
  {
    match: /architect/,
    role: 'Designs the technical approach and keeps the system coherent',
    access: 'read',
    model: 'opus',
    focus: [
      'Map the relevant parts of the existing system before proposing anything.',
      'Propose a design with clear boundaries, data flow and trade-offs; prefer the simplest design that meets the need.',
      'Flag risks: breaking changes, migrations, performance and security concerns.',
    ],
  },
  {
    match: /(backend|api|server)/,
    role: 'Implements server-side logic, APIs and data access',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Implement endpoints, business logic and persistence following the project conventions.',
      'Validate inputs, handle errors explicitly and never log secrets.',
      'Add or update tests for the behaviour you change.',
    ],
  },
  {
    match: /(frontend|front|ui-dev|web-dev)/,
    role: 'Builds user interfaces and client-side behaviour',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Build components that match the existing design system and patterns.',
      'Handle loading, empty and error states; keep the UI accessible (semantic HTML, keyboard, contrast).',
      'Verify the result builds and that existing UI tests still pass.',
    ],
  },
  {
    match: /(mobile|ios|android)/,
    role: 'Builds the mobile application screens and platform integrations',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Implement screens and navigation following the platform guidelines and project patterns.',
      'Account for offline, slow-network and small-screen cases.',
      'Keep platform-specific code isolated and tested.',
    ],
  },
  {
    match: /(review|critic)/,
    role: 'Reviews work critically and reports concrete problems',
    access: 'read',
    model: 'sonnet',
    focus: [
      'Look for bugs, unhandled edge cases, security issues and inconsistencies with the request.',
      'Rank findings by severity and point to exact locations; skip cosmetic nitpicks unless asked.',
      'Say explicitly when you found nothing significant.',
    ],
  },
  {
    match: /(test|qa|playtest)/,
    role: 'Verifies behaviour through tests and reports failures',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Identify the behaviours that matter most and the edge cases most likely to break.',
      'Write or run tests that are deterministic, isolated and named after the behaviour they check.',
      'Report failures with reproduction steps, expected vs. actual results.',
    ],
  },
  {
    match: /(bug|debug|hunter)/,
    role: 'Hunts down bugs and finds their root cause',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Reproduce the problem first, with the smallest possible case.',
      'Form hypotheses and eliminate them with evidence; find the root cause, not just the symptom.',
      'Report the cause, the evidence, and the minimal fix.',
    ],
  },
  {
    match: /(doc|writer|technical-writer)/,
    role: 'Writes and maintains clear documentation',
    access: 'write',
    model: 'haiku',
    focus: [
      'Document what changed for the people who will use it: purpose, usage, examples.',
      'Keep docs short, accurate and consistent with the code; never document behaviour you did not verify.',
      'Update existing docs rather than creating duplicates.',
    ],
  },
  {
    match: /(design|ux)/,
    role: 'Designs the experience and specifies how it should work',
    access: 'write',
    model: 'sonnet',
    focus: [
      'Clarify the goal and the audience before proposing solutions.',
      'Produce concrete specifications: flows, rules, states and examples others can implement.',
      'Explain the reasoning behind each important choice.',
    ],
  },
  {
    match: /(data|analyst|ml|scientist)/,
    role: 'Works with data: pipelines, analysis and models',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Inspect the data before transforming it: schema, volume, quality issues.',
      'Make every transformation reproducible and document assumptions.',
      'Report results with the numbers that support them, and their limits.',
    ],
  },
  {
    match: /(security|audit)/,
    role: 'Assesses security risks and recommends mitigations',
    access: 'read',
    model: 'opus',
    focus: [
      'Check authentication, authorization, input handling, secrets and dependencies.',
      'Rate each issue by impact and likelihood, with a concrete mitigation.',
      'Do not exploit anything; describe the problem class and the fix.',
    ],
  },
  {
    match: /(devops|ops|infra|deploy)/,
    role: 'Handles build, CI and infrastructure configuration',
    access: 'exec',
    model: 'sonnet',
    focus: [
      'Keep pipelines and configuration reproducible and documented.',
      'Never apply changes to shared or production environments; prepare them for review.',
      'Explain the impact of each configuration change.',
    ],
  },
  {
    match: /(research|explorer|scout)/,
    role: 'Researches the codebase or the topic and reports findings',
    access: 'read',
    model: 'haiku',
    focus: [
      'Find the relevant files, prior art and constraints quickly.',
      'Report facts with references (file paths, line numbers, sources).',
      'Separate what you verified from what you infer.',
    ],
  },
];

const GENERIC_FOCUS = [
  'Understand exactly what the lead asks of you and the expected output.',
  'Do the work thoroughly within your role; state the assumptions you make.',
  'Point out anything that blocks you or that another teammate should handle.',
];

export function profileFor(name) {
  return PROFILES.find((p) => p.match.test(name)) ?? null;
}

export function isLeadName(name) {
  return Boolean(profileFor(name)?.lead);
}

export function titleOf(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Compositions proposées selon le type de projet.
export const PROJECT_TYPES = {
  web: {
    label: 'Application web',
    agents: ['lead', 'architect', 'backend', 'frontend', 'reviewer', 'docs'],
  },
  game: {
    label: 'Jeu vidéo',
    agents: ['lead', 'game-designer', 'gameplay-dev', 'level-designer', 'playtester'],
  },
  data: {
    label: 'Data / IA',
    agents: ['lead', 'data-engineer', 'data-analyst', 'ml-engineer', 'reviewer'],
  },
  mobile: {
    label: 'Application mobile',
    agents: ['lead', 'mobile-dev', 'ux-designer', 'backend', 'tester'],
  },
  other: {
    label: 'Autre',
    agents: ['lead', 'researcher', 'builder', 'reviewer'],
  },
};

// Valeurs par défaut d'un agent : rôle, accès, modèle.
export function defaultsFor(name, { isLead = false } = {}) {
  const p = profileFor(name);
  if (isLead || p?.lead) return { role: PROFILES[0].role, access: 'read', model: 'opus' };
  if (name === 'builder') return { role: 'Produces the main deliverable of the task', access: 'write', model: 'sonnet' };
  return {
    role: p?.role ?? `${titleOf(name)} specialist`,
    access: p?.access ?? 'read',
    model: p?.model ?? 'sonnet',
  };
}

export function templatePrompt({ name, role, access, team, goal, isLead, teammates = [] }) {
  const title = titleOf(name);
  const intro = `You are the **${title}** of the "${team}" team${goal ? `, whose goal is: ${goal.replace(/\.$/, '')}` : ''}.`;

  if (isLead) {
    const roster = teammates.length
      ? teammates.map((t) => `- **${t.name}**: ${t.role}`).join('\n')
      : '- (no teammates yet)';
    return `${intro}

Your role: ${role}.

## Your team
${roster}

## How you lead
1. Restate the task in one or two sentences and identify what "done" means.
2. Split it into independent sub-tasks, each owned by the teammate whose role fits best.
3. Delegate with precise briefs: context, expected output, constraints, files concerned.
4. Run independent sub-tasks in parallel; sequence only what truly depends on another result.
5. Check each result against the brief; send it back with concrete feedback if it falls short.
6. Never do a teammate's specialised work yourself when that teammate is available.

## What you return
- **Who did what:** one line per teammate.
- **Result:** the deliverable or a summary of the changes.
- **Remaining points:** open questions, risks and suggested next steps.
`;
  }

  const p = profileFor(name);
  const focus = (p?.focus?.length ? p.focus : GENERIC_FOCUS).map((f) => `- ${f}`).join('\n');
  const rules = (ACCESS_LEVELS[access] ?? ACCESS_LEVELS.read).rules.map((r) => `- ${r}`).join('\n');
  return `${intro}

Your role: ${role}.

## Responsibilities
${focus}

## How you work
${rules}
- Stay within your role. If part of the request belongs to another teammate, say so instead of doing it.
- When the brief is ambiguous, state your assumptions and proceed; ask only if a wrong guess would be costly.

## What you return
End with a short report for the lead:
- **Done:** what you did (files touched, commands run).
- **Result:** the key output or findings.
- **Open points:** risks, questions or follow-ups.
`;
}
