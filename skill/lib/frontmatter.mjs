// Frontmatter YAML minimal (clé: valeur sur une ligne), suffisant pour les subagents Claude Code.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(text) {
  const m = FENCE.exec(text.replace(/^﻿/, ''));
  if (!m) return null;
  const data = {};
  const duplicates = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    // Drapeau s : « . » doit aussi accepter U+2028 et U+2029, sinon la ligne entière serait ignorée.
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/s.exec(line);
    if (!kv) continue;
    if (Object.hasOwn(data, kv[1])) duplicates.push(kv[1]);
    data[kv[1]] = unquote(kv[2].trim());
  }
  return { data, duplicates, body: text.replace(/^﻿/, '').slice(m[0].length) };
}

function unquote(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

// Retours à la ligne, y compris U+2028 et U+2029 que certains parseurs YAML traitent comme des sauts de ligne.
const LINE_BREAK_RE = new RegExp(`[\r\n${String.fromCharCode(0x2028, 0x2029)}]`);

function quoteIfNeeded(v) {
  const s = String(v);
  // Guillemets seulement quand YAML l'exige : « Read, Grep, Glob » reste un scalaire simple.
  if (s === '' || /: |\s#/.test(s) || LINE_BREAK_RE.test(s) || s.endsWith(':') || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /\s$/.test(s)) {
    // JSON.stringify laisse U+2028 et U+2029 tels quels : on les échappe aussi.
    return JSON.stringify(s).replace(new RegExp(LINE_BREAK_RE.source, 'g'), (ch) => '\\' + 'u' + ch.charCodeAt(0).toString(16));
  }
  return s;
}

export function renderFrontmatter(data, body) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${quoteIfNeeded(Array.isArray(v) ? v.join(', ') : v)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

// Remplace la valeur d'une clé dans le frontmatter sans toucher au reste du fichier.
export function setFrontmatterField(text, key, value) {
  // Sans retrait du BOM, la fence n'est pas reconnue et le champ resterait inchangé.
  text = text.replace(/^﻿/, '');
  const m = FENCE.exec(text);
  if (!m) return text;
  const re = new RegExp(`^${key}:.*$`, 'm');
  const line = `${key}: ${quoteIfNeeded(value)}`;
  const block = re.test(m[1]) ? m[1].replace(re, line) : `${line}\n${m[1]}`;
  return text.slice(0, m.index) + `---\n${block}\n---\n` + text.slice(m.index + m[0].length);
}

export function splitTools(tools) {
  if (!tools) return [];
  return String(tools)
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
