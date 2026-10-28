// Minimal YAML frontmatter (one "key: value" per line), enough for Claude Code subagents.
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(text) {
  const m = FENCE.exec(text.replace(/^﻿/, ''));
  if (!m) return null;
  const data = {};
  const duplicates = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    // s flag: "." must also match U+2028 and U+2029, otherwise the whole line would be skipped.
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

// Line breaks, including U+2028 and U+2029, which some YAML parsers treat as new lines.
const LINE_BREAK_RE = new RegExp(`[\r\n${String.fromCharCode(0x2028, 0x2029)}]`);

function quoteIfNeeded(v) {
  const s = String(v);
  // Quote only when YAML requires it: "Read, Grep, Glob" stays a plain scalar.
  if (s === '' || /: |\s#/.test(s) || LINE_BREAK_RE.test(s) || s.endsWith(':') || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) || /\s$/.test(s)) {
    // JSON.stringify leaves U+2028 and U+2029 as is: escape them too.
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

// Replaces the value of a frontmatter key without touching the rest of the file.
export function setFrontmatterField(text, key, value) {
  // Without removing the BOM, the fence is not recognised and the field would stay unchanged.
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
