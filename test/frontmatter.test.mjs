import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, renderFrontmatter, setFrontmatterField, splitTools } from '../skill/lib/frontmatter.mjs';

// U01
test('frontmatter: render → parse round trip is lossless', () => {
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

test('frontmatter: renderFrontmatter protects values that are ambiguous for a YAML parser', () => {
  const out = renderFrontmatter({ a: 'x: y', b: 'x #y', c: 'x:', d: '-x', e: 'x ', f: 'l1\nl2', g: 'Read, Grep' }, 'B');
  assert.equal(out, '---\na: "x: y"\nb: "x #y"\nc: "x:"\nd: "-x"\ne: "x "\nf: "l1\\nl2"\ng: Read, Grep\n---\n\nB\n');
});

test('frontmatter: renderFrontmatter omits undefined, null and empty strings', () => {
  const out = renderFrontmatter({ name: 'a', undef: undefined, nul: null, empty: '' }, 'B');
  assert.equal(out, '---\nname: a\n---\n\nB\n');
});

// U02
test('parseFrontmatter: BOM, comments, doubled apostrophes, invalid keys ignored, fence at end of file', () => {
  const text = [
    '\uFEFF---',
    '# commentaire',
    '   # indented comment',
    '',
    "description: 'it''s ok'",
    'bad key: ignored',
    'ké: ignored',
    'line without a colon',
    'name: a',
    '---',
  ].join('\n');
  const fm = parseFrontmatter(text);
  assert.deepEqual(fm.data, { description: "it's ok", name: 'a' });
  assert.equal(fm.body, '');
});

test('parseFrontmatter: double quotes with invalid JSON → raw content between the quotes', () => {
  const fm = parseFrontmatter('---\nd: "a\\q"\n---\n');
  assert.equal(fm.data.d, 'a\\q');
});

test('parseFrontmatter: no closing fence → null', () => {
  assert.equal(parseFrontmatter('---\nname: a\n'), null);
});

// U03
test('setFrontmatterField: adds a missing key at the top', () => {
  const out = setFrontmatterField('---\nname: a\n---\n\nBody\n', 'model', 'opus');
  assert.equal(out, '---\nmodel: opus\nname: a\n---\n\nBody\n');
});

test('setFrontmatterField: quotes the value when needed', () => {
  const out = setFrontmatterField('---\nname: a\ndescription: x\n---\n\nBody\n', 'description', 'Role: test');
  assert.equal(out, '---\nname: a\ndescription: "Role: test"\n---\n\nBody\n');
  assert.equal(parseFrontmatter(out).data.description, 'Role: test');
});

test('setFrontmatterField: leaves a body containing the same key alone', () => {
  const out = setFrontmatterField('---\nname: a\n---\n\nname: corps\n', 'name', 'b');
  assert.equal(out, '---\nname: b\n---\n\nname: corps\n');
});

test('setFrontmatterField: text without frontmatter unchanged', () => {
  const text = 'Pas de frontmatter\nname: x\n';
  assert.equal(setFrontmatterField(text, 'name', 'y'), text);
});

// U04
test('splitTools: brackets, extra commas, empty', () => {
  assert.deepEqual(splitTools('[Read, Grep]'), ['Read', 'Grep']);
  assert.deepEqual(splitTools('Read,, Grep ,'), ['Read', 'Grep']);
  assert.deepEqual(splitTools('Bash(git *), mcp__x'), ['Bash(git *)', 'mcp__x']);
  assert.deepEqual(splitTools('[]'), []);
  assert.deepEqual(splitTools(''), []);
  assert.deepEqual(splitTools(undefined), []);
});
