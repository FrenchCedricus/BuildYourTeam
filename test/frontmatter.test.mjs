import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, renderFrontmatter, setFrontmatterField, splitTools } from '../skill/lib/frontmatter.mjs';

// U01
test('frontmatter : aller-retour render → parse fidèle', () => {
  const values = {
    colon: 'Use it: always',
    hash: 'Read it #now',
    dash: '- leading dash',
    quote: '"quoted" start',
    single: "'single' start",
    trailingSpace: 'ends with space ',
    trailingColon: 'ends with colon:',
    newline: 'line one\nline two',
    backslash: 'C:\\path\\to\\file',
    plain: 'Read, Grep, Glob',
    apostrophe: "it's fine",
  };
  const out = renderFrontmatter({ ...values, undef: undefined, nul: null, empty: '' }, 'Body');
  const fm = parseFrontmatter(out);
  assert.deepEqual(fm.data, values);
  assert.equal(fm.body.trim(), 'Body');
});

test('frontmatter : renderFrontmatter protège les valeurs ambiguës pour un parseur YAML', () => {
  const out = renderFrontmatter({ a: 'x: y', b: 'x #y', c: 'x:', d: '-x', e: 'x ', f: 'l1\nl2', g: 'Read, Grep' }, 'B');
  assert.equal(out, '---\na: "x: y"\nb: "x #y"\nc: "x:"\nd: "-x"\ne: "x "\nf: "l1\\nl2"\ng: Read, Grep\n---\n\nB\n');
});

test('frontmatter : renderFrontmatter omet undefined, null et chaîne vide', () => {
  const out = renderFrontmatter({ name: 'a', undef: undefined, nul: null, empty: '' }, 'B');
  assert.equal(out, '---\nname: a\n---\n\nB\n');
});

// U02
test('parseFrontmatter : BOM, commentaires, apostrophes doublées, clés invalides ignorées, fence en fin de fichier', () => {
  const text = [
    '\uFEFF---',
    '# commentaire',
    '   # commentaire indenté',
    '',
    "description: 'it''s ok'",
    'bad key: ignorée',
    'ké: ignorée',
    'ligne sans deux-points',
    'name: a',
    '---',
  ].join('\n');
  const fm = parseFrontmatter(text);
  assert.deepEqual(fm.data, { description: "it's ok", name: 'a' });
  assert.equal(fm.body, '');
});

test('parseFrontmatter : guillemets doubles au JSON invalide → contenu brut entre guillemets', () => {
  const fm = parseFrontmatter('---\nd: "a\\q"\n---\n');
  assert.equal(fm.data.d, 'a\\q');
});

test('parseFrontmatter : sans fence fermante → null', () => {
  assert.equal(parseFrontmatter('---\nname: a\n'), null);
});

// U03
test('setFrontmatterField : ajoute la clé absente en tête', () => {
  const out = setFrontmatterField('---\nname: a\n---\n\nBody\n', 'model', 'opus');
  assert.equal(out, '---\nmodel: opus\nname: a\n---\n\nBody\n');
});

test('setFrontmatterField : met la valeur entre guillemets si nécessaire', () => {
  const out = setFrontmatterField('---\nname: a\ndescription: x\n---\n\nBody\n', 'description', 'Role: test');
  assert.equal(out, '---\nname: a\ndescription: "Role: test"\n---\n\nBody\n');
  assert.equal(parseFrontmatter(out).data.description, 'Role: test');
});

test('setFrontmatterField : ne touche pas au corps qui contient la même clé', () => {
  const out = setFrontmatterField('---\nname: a\n---\n\nname: corps\n', 'name', 'b');
  assert.equal(out, '---\nname: b\n---\n\nname: corps\n');
});

test('setFrontmatterField : texte sans frontmatter inchangé', () => {
  const text = 'Pas de frontmatter\nname: x\n';
  assert.equal(setFrontmatterField(text, 'name', 'y'), text);
});

// U04
test('splitTools : crochets, virgules en trop, vide', () => {
  assert.deepEqual(splitTools('[Read, Grep]'), ['Read', 'Grep']);
  assert.deepEqual(splitTools('Read,, Grep ,'), ['Read', 'Grep']);
  assert.deepEqual(splitTools('Bash(git *), mcp__x'), ['Bash(git *)', 'mcp__x']);
  assert.deepEqual(splitTools('[]'), []);
  assert.deepEqual(splitTools(''), []);
  assert.deepEqual(splitTools(undefined), []);
});
