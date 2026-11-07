// What a resumed chat session is told about its instructions. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { catchUp, NOW, parseSession, saveSession, sectionsOf, sessionIdIn } from './resume.ts';

// A job description with a heading the office also uses, as the managers' do.
const desk = 'You run the office.\n\n## Who you work for\n\nThe owner, kindly.';
const office = (tools: string, how = `- It is ${NOW} now.`) =>
  `\n\n## Who you work for\n\n- Ada.\n\n## What you can do\n\n${tools}\n\n## How the office works\n\n${how}\n`;
const system = (d: string, o: string) => `${d}\n${o}`;
const now = (d = desk, o = office('- None yet.')) => sectionsOf(system(d, o), d);

test('the job description is one section, even when it holds a heading the office uses', () => {
  const s = now();
  assert.deepEqual(Object.keys(s), [
    '## Your job description',
    '## Who you work for',
    '## What you can do',
    '## How the office works'
  ]);
  assert.match(s['## Your job description'], /The owner, kindly\./);
  assert.equal(s['## Who you work for'], '## Who you work for\n\n- Ada.');
});

test('a prompt that does not open with the job description is refused', () => {
  assert.throws(() => sectionsOf('Something else', desk));
});

test('a resumed session that saw every section is told only the time', () => {
  assert.equal(catchUp(now(), now(), 'Tuesday, 9:41 PM'), '(It is Tuesday, 9:41 PM now.)\n\n');
});

test('a changed section is sent in full, and the unchanged ones are not', () => {
  const update = catchUp(now(), now(desk, office('- Gmail, to read.')), 'Tuesday');
  assert.match(
    update,
    /replace the earlier versions:\n\n## What you can do\n\n- Gmail, to read\.\)/
  );
  assert.doesNotMatch(
    update,
    /## Who you work for|## How the office works|## Your job description/
  );
});

test('the time changing is not an update, and a sent section carries the time now', () => {
  assert.doesNotMatch(catchUp(now(), now(), 'Wednesday'), /updated your instructions/);
  const how = `- Oddboro updates at 2:00 AM. It is ${NOW} now.`;
  const update = catchUp(now(), now(desk, office('- None yet.', how)), 'Wednesday, 1:40 AM');
  assert.match(update, /Oddboro updates at 2:00 AM\. It is Wednesday, 1:40 AM now\./);
  assert.doesNotMatch(update, /\{now\}/);
});

test('a changed job description is sent under its own heading', () => {
  const update = catchUp(now(), now('You run the office, and the books.'), 'Tuesday');
  assert.match(update, /## Your job description\n\nYou run the office, and the books\./);
});

test('a session the office never recorded a prompt for gets every section once', () => {
  const update = catchUp(undefined, now(), 'Tuesday');
  for (const heading of Object.keys(now())) assert.ok(update.includes(heading), heading);
});

test('a section the session saw that the prompt no longer has is named as gone', () => {
  const seen = { ...now(), '## This run': '## This run\n\nDo the job.' };
  assert.match(catchUp(seen, now(), 'Tuesday'), /no longer apply: This run\./);
});

test('session.json from before keeps its session and has nothing seen', () => {
  assert.deepEqual(parseSession('{"sessionId":"abc"}'), { sessionId: 'abc' });
});

test('session.json keeps the sections its session saw', () => {
  const seen = now();
  assert.deepEqual(parseSession(JSON.stringify({ sessionId: 'abc', seen })), {
    sessionId: 'abc',
    seen
  });
});

test('a saved session.json keeps what its session saw, so its next turn resends nothing unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-session-'));
  try {
    const file = join(dir, 'session.json');
    saveSession(file, { sessionId: 'abc', seen: now(), home: '' });
    const saved = parseSession(readFileSync(file, 'utf8'));
    assert.deepEqual(saved, { sessionId: 'abc', seen: now(), home: '' });
    assert.equal(catchUp(saved?.seen, now(), 'Tuesday'), '(It is Tuesday now.)\n\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a broken or misshapen session.json starts a new session or resends the prompt', () => {
  assert.equal(parseSession('{not json'), undefined);
  assert.equal(parseSession('{"seen":{}}'), undefined);
  assert.deepEqual(parseSession('{"sessionId":"abc","seen":{"## A":3}}'), { sessionId: 'abc' });
});

test('a chat has a session only while its session file names one: a missing, broken or unreadable file has none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-session-'));
  try {
    const file = join(dir, 'session.json');
    assert.equal(sessionIdIn(file, ''), undefined);
    saveSession(file, { sessionId: 'abc', seen: now(), home: '/accounts/grok/office' });
    assert.equal(sessionIdIn(file, '/accounts/grok/office'), 'abc');
    // A session lives in its tool's folder: an Odd moved to another account starts a new one.
    assert.equal(sessionIdIn(file, '/accounts/grok/a1b2c3d4'), undefined);
    // One saved before the office kept its folder belongs to the owner's own login.
    writeFileSync(file, JSON.stringify({ sessionId: 'old' }));
    assert.equal(sessionIdIn(file, ''), 'old');
    writeFileSync(file, '{not json');
    assert.equal(sessionIdIn(file, ''), undefined);
    // A folder where the file should be cannot be read as one.
    assert.equal(sessionIdIn(dir, ''), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a session stays with its model source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-source-'));
  const file = join(dir, 'session.json');
  try {
    saveSession(file, { sessionId: 'a', seen: now(), home: '/account', source: 'magpie:group/a' });
    assert.equal(sessionIdIn(file, '/account', 'magpie:group/a'), 'a');
    assert.equal(sessionIdIn(file, '/account', 'magpie:group/b'), undefined);
    assert.equal(sessionIdIn(file, '/account', ''), undefined);
    assert.equal(sessionIdIn(file, '/other', 'magpie:group/a'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
