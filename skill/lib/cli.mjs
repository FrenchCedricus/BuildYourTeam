import { createContext } from './context.mjs';
import { createColors } from './format.mjs';
import { BytError, errors } from './errors.mjs';
import { COMMANDS } from './commands.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'project', 'global', 'available', 'force', 'strict', 'help', 'version']);

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--') && arg.length > 2) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      let value = eq === -1 ? undefined : arg.slice(eq + 1);
      if (value === undefined) {
        if (BOOLEAN_FLAGS.has(key)) value = true;
        else if (i + 1 < argv.length) value = argv[++i];
        else throw errors.usage(`--${key} <value>`);
      }
      flags[key] = value;
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0], _: positionals.slice(1), flags };
}

// Testable entry point: every input and output can be injected.
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  const ctx = io.ctx ?? createContext();
  let json = argv.includes('--json');
  ctx.c = createColors(!json && Boolean(stdout.isTTY) && !ctx.env.NO_COLOR);
  ctx.io = { stdin, stdout, stderr };

  try {
    const args = parseArgs(argv);
    json = Boolean(args.flags.json);
    let name = args.command ?? 'help';
    if (args.flags.version && !args.command) name = 'version';
    if (args.flags.help) {
      args._ = args.command ? [args.command] : [];
      name = 'help';
    }
    const handler = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
    if (!handler) throw errors.unknownCommand(name);
    const result = (await handler(ctx, args)) ?? {};
    if (json) {
      stdout.write(JSON.stringify({ ok: true, command: name, data: result.data ?? null }, null, 2) + '\n');
    } else if (result.text) {
      stdout.write(result.text + '\n');
    }
    return 0;
  } catch (e) {
    const err = e instanceof BytError ? e : new BytError('INTERNAL', `Erreur inattendue : ${e.message}`);
    if (json) {
      const error = { code: err.code, message: err.message };
      if (err.hint) error.hint = err.hint;
      if (err.data) error.data = err.data;
      stdout.write(JSON.stringify({ ok: false, error }, null, 2) + '\n');
    } else {
      if (err.details) stdout.write(err.details + '\n\n');
      stderr.write(`${ctx.c.red('✖')} ${err.message}\n`);
      if (err.hint) stderr.write(`  ${ctx.c.dim('→')} ${err.hint}\n`);
      if (err.code === 'INTERNAL' && ctx.env.BYT_DEBUG) stderr.write(e.stack + '\n');
    }
    return 1;
  }
}
