import path from 'node:path';
import { readJson, writeJson } from './fsutil.mjs';
import { BytError } from './errors.mjs';

export const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/FrenchCedricus/BuildYourTeam/main';

const KEYS = {
  registry: 'URL de base du registry (dossier contenant registry.json)',
};

function configPath(ctx) {
  return path.join(ctx.bytHome, 'config.json');
}

export function loadConfig(ctx) {
  const stored = readJson(configPath(ctx), {});
  const config = { registry: DEFAULT_REGISTRY, ...stored };
  if (ctx.env.BYT_REGISTRY) config.registry = ctx.env.BYT_REGISTRY;
  return config;
}

export function setConfig(ctx, key, value) {
  if (!Object.hasOwn(KEYS, key)) {
    throw new BytError('UNKNOWN_CONFIG_KEY', `Clé de configuration inconnue : « ${key} ».`, `Clés disponibles : ${Object.keys(KEYS).join(', ')}`);
  }
  const stored = readJson(configPath(ctx), {});
  stored[key] = value;
  writeJson(configPath(ctx), stored);
  return loadConfig(ctx);
}

export const CONFIG_KEYS = KEYS;
