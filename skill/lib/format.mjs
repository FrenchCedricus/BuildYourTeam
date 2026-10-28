// Mise en forme terminal, sans dépendance. Les couleurs sont désactivées hors TTY et avec NO_COLOR.
export function createColors(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
  };
}

export const plain = createColors(false);

export function table(rows, { indent = '  ' } = {}) {
  if (rows.length === 0) return '';
  const visible = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => visible(r[i] ?? '').length)));
  return rows
    .map((r) =>
      indent +
      r
        .map((cell, i) => (i === r.length - 1 ? String(cell ?? '') : String(cell ?? '') + ' '.repeat(widths[i] - visible(cell ?? '').length)))
        .join('  ')
        .trimEnd()
    )
    .join('\n');
}
