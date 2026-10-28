import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, resolveScope, agentTeamsEnabled } from '../skill/lib/context.mjs';
import { parseArgs } from '../skill/lib/cli.mjs';
import { readJson, writeText, replaceDir } from '../skill/lib/fsutil.mjs';
import { table } from '../skill/lib/format.mjs';
import { loadConfig, DEFAULT_REGISTRY } from '../skill/lib/config.mjs';
import { sandbox } from './helpers.mjs';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code);

function withSandbox(fn) {
  const sb = sandbox();
  try {
    return fn(sb);
  } finally {
    sb.cleanup();
  }
}

// Contexte dont le dossier courant est le « dossier personnel » (parent de .byt et .claude).
const homeCtx = (sb) => createContext({ env: { ...sb.env }, cwd: path.dirname(sb.dirs.bytHome) });

// U15
test('resolveScope : --project et --global ensemble → CONFLICTING_SCOPES', () => {
  withSandbox((sb) => {
    throwsCode(() => resolveScope(sb.ctx(), { project: true, global: true }, 'project'), 'CONFLICTING_SCOPES');
  });
});

test('resolveScope : --project dans le dossier personnel → PROJECT_SCOPE_UNAVAILABLE', () => {
  withSandbox((sb) => {
    throwsCode(() => resolveScope(homeCtx(sb), { project: true }, 'project'), 'PROJECT_SCOPE_UNAVAILABLE');
  });
});

test('resolveScope : défaut projet replié sur global dans le dossier personnel', () => {
  withSandbox((sb) => {
    assert.equal(resolveScope(homeCtx(sb), {}, 'project'), 'global');
  });
});

test('resolveScope : drapeaux explicites et portée par défaut', () => {
  withSandbox((sb) => {
    const ctx = sb.ctx();
    assert.equal(resolveScope(ctx, {}, 'project'), 'project');
    assert.equal(resolveScope(ctx, {}, 'global'), 'global');
    assert.equal(resolveScope(ctx, { global: true }, 'project'), 'global');
    assert.equal(resolveScope(ctx, { project: true }, 'global'), 'project');
  });
});

// U16
test('createContext : BYT_CLAUDE_DIR prioritaire sur CLAUDE_CONFIG_DIR', () => {
  const a = path.join(os.tmpdir(), 'byt-a');
  const b = path.join(os.tmpdir(), 'byt-b');
  assert.equal(createContext({ env: { BYT_CLAUDE_DIR: a, CLAUDE_CONFIG_DIR: b }, cwd: os.tmpdir() }).claudeDir, path.resolve(a));
  assert.equal(createContext({ env: { CLAUDE_CONFIG_DIR: b }, cwd: os.tmpdir() }).claudeDir, path.resolve(b));
});

test('createContext : BYT_HOME et valeurs par défaut', () => {
  const h = path.join(os.tmpdir(), 'byt-h');
  const ctx = createContext({ env: { BYT_HOME: h }, cwd: os.tmpdir() });
  assert.equal(ctx.bytHome, path.resolve(h));
  assert.equal(ctx.claudeDir, path.join(os.homedir(), '.claude'));
  assert.equal(createContext({ env: {}, cwd: os.tmpdir() }).bytHome, path.join(os.homedir(), '.byt'));
});

// U17
const KEY = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
const ctxWithEnv = (sb, extra) => createContext({ env: { ...sb.env, ...extra }, cwd: sb.dirs.project });
const writeSettings = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
};

test('agentTeamsEnabled : variable d\'environnement 0/false/vide → désactivé', () => {
  withSandbox((sb) => {
    for (const v of ['0', 'false', 'FALSE', '']) assert.equal(agentTeamsEnabled(ctxWithEnv(sb, { [KEY]: v })), false, `« ${v} »`);
    assert.equal(agentTeamsEnabled(ctxWithEnv(sb, {})), false);
  });
});

test('agentTeamsEnabled : variable d\'environnement vraie → activé', () => {
  withSandbox((sb) => {
    assert.equal(agentTeamsEnabled(ctxWithEnv(sb, { [KEY]: '1' })), true);
  });
});

test('agentTeamsEnabled : settings.json global', () => {
  withSandbox((sb) => {
    writeSettings(path.join(sb.dirs.claudeDir, 'settings.json'), { env: { [KEY]: '1' } });
    assert.equal(agentTeamsEnabled(sb.ctx()), true);
  });
});

test('agentTeamsEnabled : valeur fausse dans settings.json ignorée', () => {
  withSandbox((sb) => {
    writeSettings(path.join(sb.dirs.claudeDir, 'settings.json'), { env: { [KEY]: '0' } });
    assert.equal(agentTeamsEnabled(sb.ctx()), false);
  });
});

test('agentTeamsEnabled : settings.local.json projet', () => {
  withSandbox((sb) => {
    writeSettings(path.join(sb.dirs.project, '.claude', 'settings.local.json'), { env: { [KEY]: 'true' } });
    assert.equal(agentTeamsEnabled(sb.ctx()), true);
  });
});

test('agentTeamsEnabled : JSON corrompu ignoré', () => {
  withSandbox((sb) => {
    writeSettings(path.join(sb.dirs.claudeDir, 'settings.json'), '{ corrompu');
    assert.equal(agentTeamsEnabled(sb.ctx()), false);
    writeSettings(path.join(sb.dirs.project, '.claude', 'settings.json'), { env: { [KEY]: '1' } });
    assert.equal(agentTeamsEnabled(sb.ctx()), true, 'un fichier corrompu n\'empêche pas de lire les suivants');
  });
});

// U18
test('parseArgs : -- termine les options', () => {
  assert.deepEqual(parseArgs(['run', '--', '--json', 'x']), { command: 'run', _: ['--json', 'x'], flags: {} });
});

test('parseArgs : -h active l\'aide', () => {
  assert.deepEqual(parseArgs(['list', '-h']), { command: 'list', _: [], flags: { help: true } });
});

test('parseArgs : option à valeur manquante → USAGE', () => {
  throwsCode(() => parseArgs(['new', '--data']), 'USAGE');
});

test('parseArgs : --flag=valeur et --flag valeur', () => {
  const r = parseArgs(['new', '--data={"a":"b=c"}', '--author', 'moi', '--json', 'pos']);
  assert.deepEqual(r, { command: 'new', _: ['pos'], flags: { data: '{"a":"b=c"}', author: 'moi', json: true } });
});

// U19
test('readJson : repli si absent, erreur sinon', () => {
  withSandbox((sb) => {
    const missing = path.join(sb.dirs.root, 'absent.json');
    assert.deepEqual(readJson(missing, { d: 1 }), { d: 1 });
    assert.throws(() => readJson(missing), (e) => e.code === 'INVALID_JSON' && /introuvable/.test(e.message));
  });
});

test('readJson : fichier corrompu → INVALID_JSON même avec repli', () => {
  withSandbox((sb) => {
    const f = path.join(sb.dirs.root, 'bad.json');
    fs.writeFileSync(f, '{ corrompu');
    throwsCode(() => readJson(f, {}), 'INVALID_JSON');
  });
});

test('writeText : crée les dossiers et ne laisse pas de .tmp', () => {
  withSandbox((sb) => {
    const f = path.join(sb.dirs.root, 'a', 'b', 'c.txt');
    writeText(f, 'contenu');
    assert.equal(fs.readFileSync(f, 'utf8'), 'contenu');
    assert.deepEqual(fs.readdirSync(path.dirname(f)), ['c.txt']);
    writeText(f, 'nouveau');
    assert.equal(fs.readFileSync(f, 'utf8'), 'nouveau');
  });
});

test('replaceDir : remplace le dossier existant et déplace la source', () => {
  withSandbox((sb) => {
    const src = path.join(sb.dirs.root, 'src');
    const dest = path.join(sb.dirs.root, 'x', 'dest');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'new.txt'), 'n');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'old.txt'), 'o');
    replaceDir(src, dest);
    assert.deepEqual(fs.readdirSync(dest), ['new.txt']);
    assert.equal(fs.existsSync(src), false);
  });
});

test('replaceDir : crée le parent si la destination est absente', () => {
  withSandbox((sb) => {
    const src = path.join(sb.dirs.root, 'src');
    const dest = path.join(sb.dirs.root, 'p', 'q', 'dest');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'f.txt'), 'f');
    replaceDir(src, dest);
    assert.deepEqual(fs.readdirSync(dest), ['f.txt']);
  });
});

// U20
test('table : aligne les colonnes en ignorant les codes ANSI', () => {
  const out = table([
    ['\x1b[1mName\x1b[0m', 'X'],
    ['ab', 'Y'],
  ]);
  assert.equal(out, '  \x1b[1mName\x1b[0m  X\n  ab    Y');
  assert.equal(table([]), '');
});

test('table : dernière colonne non complétée et cellules manquantes', () => {
  assert.equal(table([['a', 'long'], ['bb']], { indent: '' }), 'a   long\nbb');
});

test('loadConfig : BYT_REGISTRY prioritaire sur config.json', () => {
  withSandbox((sb) => {
    fs.mkdirSync(sb.dirs.bytHome, { recursive: true });
    fs.writeFileSync(path.join(sb.dirs.bytHome, 'config.json'), JSON.stringify({ registry: 'file:///stocke' }));
    assert.equal(loadConfig({ bytHome: sb.dirs.bytHome, env: { BYT_REGISTRY: 'file:///env' } }).registry, 'file:///env');
    assert.equal(loadConfig({ bytHome: sb.dirs.bytHome, env: {} }).registry, 'file:///stocke');
  });
});

test('loadConfig : défaut GitHub', () => {
  withSandbox((sb) => {
    const config = loadConfig({ bytHome: sb.dirs.bytHome, env: {} });
    assert.equal(config.registry, DEFAULT_REGISTRY);
    assert.match(DEFAULT_REGISTRY, /^https:\/\/raw\.githubusercontent\.com\//);
  });
});
