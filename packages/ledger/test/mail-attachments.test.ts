// Which file in an Odd's folder an email may carry (`mailAttachment`): only a
// file where it really is, named with no link on the way, never one of the
// office's own files at the top of the folder, and a file of the same name
// below the top goes. The folders are fake, in the test's own home. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { after, test } from 'node:test';

// A home of its own, set before home.ts reads it, so a shell's ODDBORO_HOME
// (a dev office) never gets these fake Odds.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'mail-attachments-')));
process.env.ODDBORO_HOME = HOME;
after(() => rmSync(HOME, { recursive: true, force: true }));
const { home, isWhereNamed, OFFICE_FILES } = await import('../src/home.ts');
const { mailAttachment } = await import('../src/mail-attachments.ts');

const refused = (named: string) => ({ problem: `${named} is not a file in your folder.` });
const linked = (named: string) => ({
  problem: `${named} is reached through a link, and an email carries only a file where it really is. Name the file itself.`
});
// A junction on Windows, which needs no admin.
const linkFolder = (to: string, at: string) =>
  symlinkSync(to, at, process.platform === 'win32' ? 'junction' : 'dir');

// Mia's `notes` is a link back to her own folder, so each office file there is
// reachable under another path, and her `cfg` a link to her tool's hidden
// settings.
const mia = home('staff', 'mia');
mkdirSync(join(mia, '.codex'), { recursive: true });
for (const name of Object.values(OFFICE_FILES)) writeFileSync(join(mia, name), '{}');
writeFileSync(join(mia, '.codex', 'config.toml'), 'model = "x"');
linkFolder(mia, join(mia, 'notes'));
linkFolder(join(mia, '.codex'), join(mia, 'cfg'));

// Noa's `notes` is a real folder, with files of her own, and her
// `attachments` holds a file the owner gave her in chat.
const noa = home('staff', 'noa');
mkdirSync(join(noa, 'notes'), { recursive: true });
mkdirSync(join(noa, 'attachments'), { recursive: true });
writeFileSync(join(noa, OFFICE_FILES.chat), '{}');
writeFileSync(join(noa, 'notes', OFFICE_FILES.chat), 'her own notes');
writeFileSync(join(noa, 'notes', 'intake.md'), 'intake');
writeFileSync(join(noa, 'attachments', '20261110-081108-35bc-image.png'), 'png');

// Ivy's `notes` is a link to another real folder inside her own.
const ivy = home('staff', 'ivy');
mkdirSync(join(ivy, 'drafts'), { recursive: true });
writeFileSync(join(ivy, 'drafts', 'intake.md'), 'intake');
linkFolder(join(ivy, 'drafts'), join(ivy, 'notes'));

// Lea's accented name, stored composed in `drafts` and decomposed in
// `letters`, as an unzip or a download may leave it.
const composed = 'Résumé.pdf';
const decomposed = composed.normalize('NFD');
const lea = home('staff', 'lea');
mkdirSync(join(lea, 'drafts'), { recursive: true });
mkdirSync(join(lea, 'letters'), { recursive: true });
writeFileSync(join(lea, 'drafts', composed), 'cv');
writeFileSync(join(lea, 'letters', decomposed), 'cv');
// A Mac's disk opens a name in either form. Linux's and Windows's keep the
// two forms as separate names, so there the other form names no file.
const foldsForms = existsSync(join(lea, 'drafts', decomposed));

test("an office file named at the top of the Odd's folder is refused", () => {
  assert.deepEqual(mailAttachment('mia', OFFICE_FILES.chat), refused(OFFICE_FILES.chat));
});

test('an office file named in another letter case is refused', () => {
  // On a Mac's disk this name opens the office's file. On Linux no file has
  // this name, so it is refused as missing: refused either way.
  const named = 'Chat.JSONL';
  assert.deepEqual(mailAttachment('mia', named), refused(named));
});

test("the chat log named through a folder linked to the Odd's own is refused", () => {
  const named = `notes/${OFFICE_FILES.chat}`;
  assert.deepEqual(mailAttachment('mia', named), linked(named));
});

test("the sessions named through a folder linked to the Odd's own are refused", () => {
  for (const name of [OFFICE_FILES.session, OFFICE_FILES.personaSession]) {
    const named = `notes/${name}`;
    assert.deepEqual(mailAttachment('mia', named), linked(named), named);
  }
});

test("an office file named by its full path in the Odd's folder is refused", () => {
  const named = join(mia, OFFICE_FILES.chat);
  assert.deepEqual(mailAttachment('mia', named), refused(named));
});

test('a hidden file named through a folder linked to it is refused', () => {
  const named = 'cfg/config.toml';
  assert.deepEqual(mailAttachment('mia', named), linked(named));
});

test("a file named through a link to another folder inside the Odd's own is refused", () => {
  const named = 'notes/intake.md';
  assert.deepEqual(mailAttachment('ivy', named), linked(named));
});

test('a file on another drive, as Windows gives it, is never where it was named', () => {
  const folder = 'C:\\Oddboro\\staff\\mia';
  for (const file of ['D:\\private\\tax.pdf', '\\\\server\\share\\tax.pdf']) {
    const realInside = win32.relative(folder, file);
    // Even named by that very path, it is outside the folder.
    for (const named of [realInside, 'notes\\tax.pdf'])
      assert.equal(isWhereNamed({ realInside, named }), false, `${file} as ${named}`);
  }
  const outside = win32.relative(folder, 'C:\\Oddboro\\tax.pdf');
  assert.equal(isWhereNamed({ realInside: outside, named: outside }), false, outside);
  assert.equal(isWhereNamed({ realInside: 'notes\\tax.pdf', named: 'Notes/Tax.pdf' }), true);
});

test("a real file below the top that shares an office file's name attaches", () => {
  assert.deepEqual(mailAttachment('noa', `notes/${OFFICE_FILES.chat}`), {
    path: `notes/${OFFICE_FILES.chat}`,
    name: OFFICE_FILES.chat,
    mediaType: 'application/octet-stream',
    size: 'her own notes'.length
  });
});

test('an ordinary file below the top attaches', () => {
  assert.deepEqual(mailAttachment('noa', 'notes/intake.md'), {
    path: 'notes/intake.md',
    name: 'intake.md',
    mediaType: 'text/markdown',
    size: 'intake'.length
  });
});

test('a file the owner attached in chat goes under the name it had', () => {
  assert.deepEqual(mailAttachment('noa', 'attachments/20261110-081108-35bc-image.png'), {
    path: 'attachments/20261110-081108-35bc-image.png',
    name: 'image.png',
    mediaType: 'image/png',
    size: 'png'.length
  });
});

test("an ordinary file named by its full path in the Odd's folder attaches", () => {
  assert.deepEqual(mailAttachment('noa', join(noa, 'notes', 'intake.md')), {
    path: 'notes/intake.md',
    name: 'intake.md',
    mediaType: 'text/markdown',
    size: 'intake'.length
  });
});

// Where the disk keeps both forms apart, no file has that name: refused as missing.
const attachesInOtherForm = (named: string) =>
  assert.deepEqual(
    mailAttachment('lea', named),
    foldsForms
      ? { path: named, name: named.split('/')[1], mediaType: 'application/pdf', size: 'cv'.length }
      : refused(named)
  );

test('an accented name stored composed and named decomposed attaches where the disk opens either form', () =>
  attachesInOtherForm(`drafts/${decomposed}`));

test('an accented name stored decomposed and named composed attaches where the disk opens either form', () =>
  attachesInOtherForm(`letters/${composed}`));
