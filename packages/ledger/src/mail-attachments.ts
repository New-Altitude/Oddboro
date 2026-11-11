// Files an Odd attaches to an email it proposes, or hands a colleague. Only a
// plain file inside the Odd's own folder: the files the owner attached in
// chat (its `attachments/`), and what it made. Checked when the Odd proposes the
// email and again when the office sends it, since the file may change.
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { home, isOfficeFile, isWhereNamed } from './home.ts';

/** One file on an email, by its path inside the Odd's folder. */
export type MailAttachment = { path: string; name: string; mediaType: string; size: number };

export const MAIL_FILES_MAX = 10;
/** All of an email's files together; Gmail takes 25 MB, and base64 adds a third. */
export const MAIL_BYTES_MAX = 18 * 1024 * 1024;

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  ics: 'text/calendar',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

/**
 * The name a recipient sees: a file the owner attached in chat loses the
 * time and random letters the office kept it under ("20261110-081108-35bc-
 * image.png" goes as "image.png"). Any other file keeps its own name.
 */
export const sentName = (name: string): string =>
  name.replace(/^\d{8}-\d{6}-[0-9a-f]{4}-(?=.)/, '');

/** A file's type by its extension, else plain bytes. */
export const mailType = (name: string): string =>
  TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/**
 * One file the Odd names, by its path inside its folder or its full path
 * there, checked: a plain file (no link, no folder), where it really is with no
 * link on the way, not hidden and not the office's own. Otherwise the words
 * that turn it down.
 */
export function mailAttachment(
  staffId: string,
  named: string
): MailAttachment | { problem: string } {
  const dir = home('staff', staffId);
  const nope = { problem: `${named} is not a file in your folder.` };
  const rel = isAbsolute(named) ? relative(dir, named) : named;
  const parts = rel.split(/[\\/]/);
  if (!rel || isAbsolute(rel) || parts.some((p) => !p || p === '.' || p === '..')) return nope;
  if (parts.some((p) => p.startsWith('.'))) return nope;
  const path = join(dir, rel);
  try {
    const st = lstatSync(path);
    if (!st.isFile()) return nope;
    const realInside = relative(realpathSync.native(dir), realpathSync.native(path));
    if (!isWhereNamed({ realInside, named: rel }))
      return {
        problem: `${named} is reached through a link, and an email carries only a file where it really is. Name the file itself.`
      };
    if (isOfficeFile(realInside)) return nope;
    if (!st.size) return { problem: `${named} is empty.` };
    return {
      path: parts.join('/'),
      name: sentName(basename(path)),
      mediaType: mailType(path),
      size: st.size
    };
  } catch {
    return nope;
  }
}

/** Every file checked, within the limits, or the words that turn the set down. */
export function mailAttachments(
  staffId: string,
  named: string[]
): MailAttachment[] | { problem: string } {
  if (named.length > MAIL_FILES_MAX)
    return { problem: `Name up to ${MAIL_FILES_MAX} files at once.` };
  const out: MailAttachment[] = [];
  for (const n of named) {
    const a = mailAttachment(staffId, n);
    if ('problem' in a) return a;
    if (!out.some((o) => o.path === a.path)) out.push(a);
  }
  if (out.reduce((s, a) => s + a.size, 0) > MAIL_BYTES_MAX)
    return { problem: 'Those files come to over 18 MB together. Name fewer.' };
  return out;
}

/** A file's full path in the Odd's folder, for the office to read as it sends. */
export const mailAttachmentPath = (staffId: string, a: MailAttachment) =>
  join(home('staff', staffId), a.path);
