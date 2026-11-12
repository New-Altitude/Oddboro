// The files the owner attaches in a chat, kept in the Odd's own `attachments/`
// folder. Every run already reads that folder, so each tool opens them with
// the file tools it has. Nothing else on the computer is touched.
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { home } from '@oddboro/ledger/home';
import { fixedError } from '@oddboro/ledger/errors';
import { attachableType, extensionFor, type ChatFile } from '#lib/attachments.ts';
import type { KeptFile } from './chat-preface.ts';

const FOLDER = 'attachments';
/** A kept file's name: no folder, no hidden file, nothing a shell or glob reads as special. */
const KEPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

const attachmentsOf = (id: string) => join(home('staff'), id, FOLDER);

/**
 * Whether the Odd's attachments folder is a real folder inside its real
 * folder. An Odd writes its own folder, so it can swap `attachments/` for a
 * link, then name a file there on a forged line in its chat.jsonl: no file is
 * kept, read or retold through such a folder (as `learnFromReply` refuses).
 */
function ownAttachments(id: string): boolean {
  try {
    return realpathSync(attachmentsOf(id)) === join(realpathSync(home('staff', id)), FOLDER);
  } catch {
    // No folder yet, or no Odd: nothing is there to read.
    return false;
  }
}

/** The original name cut to safe letters, so a kept name reads like the file it came from. */
function stem(name: string): string {
  const base = name.replace(/\.[^.]*$/, '');
  return (
    base
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 60) || 'file'
  );
}

/** Keep one attached file in the Odd's attachments folder. Throws when the office does not take it. */
export function keepAttachment(
  id: string,
  original: string,
  type: string,
  bytes: Uint8Array
): Omit<ChatFile, 'tag'> {
  const mediaType = attachableType(original, type);
  if (!mediaType) throw new Error('Attach a picture, a PDF or a text file.');
  const dir = attachmentsOf(id);
  mkdirSync(dir, { recursive: true });
  if (!ownAttachments(id))
    throw fixedError("This Odd's attachments folder is not its own, so the file was not kept.");
  const at = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const end = `${stem(original)}.${extensionFor(original, mediaType)}`;
  // A file of the same name in the same second gets other random letters:
  // `wx` never writes over a file already there, so it tries again.
  for (let tries = 0; ; tries++) {
    const name = `${at}-${randomBytes(2).toString('hex')}-${end}`;
    try {
      writeFileSync(join(dir, name), bytes, { flag: 'wx', mode: 0o600 });
      return { name, mediaType, size: bytes.byteLength };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || tries >= 9) throw e;
    }
  }
}

/** A kept file's path in the Odd's own folder, as its office tools name it. */
export const keptAt = (name: string): string => `${FOLDER}/${name}`;

/**
 * A kept file's name without the time and letters `keepAttachment` put first:
 * the owner's own name for it, in safe letters, as `tell_lead` lands it in a work.
 */
export const plainName = (name: string): string => name.replace(/^\d{8}-\d{6}-[0-9a-f]{4}-/, '');

/** The full path of a kept file, only when it is a plain file in the Odd's own attachments folder. */
export function attachmentPath(id: string, name: string): string | undefined {
  if (!KEPT.test(name) || !ownAttachments(id)) return undefined;
  const path = join(attachmentsOf(id), name);
  try {
    return lstatSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The files an owner line names, as they are now, each through
 * `attachedFiles`: one deleted since is `gone`, so the rest still reach the run.
 */
export function filesNow(id: string, files: ChatFile[]): KeptFile[] {
  return files.map((f) => {
    try {
      return attachedFiles(id, [f])[0];
    } catch {
      // Not there any more: the run hears it is gone, never a path to nothing.
      return { tag: f.tag, gone: true };
    }
  });
}

/** The attachments a message names, checked against the attachments folder; throws on one that is not there. */
export function attachedFiles(id: string, files: unknown): (ChatFile & { path: string })[] {
  if (files === undefined) return [];
  if (!Array.isArray(files)) throw new Error('Those attachments are not a list');
  return files.map((f: Partial<ChatFile>) => {
    const path = typeof f?.name === 'string' ? attachmentPath(id, f.name) : undefined;
    const mediaType = path ? attachableType(f.name!, '') : undefined;
    if (!path || !mediaType || typeof f.tag !== 'string' || !f.tag.trim())
      throw new Error('An attachment is missing. Attach it again.');
    return {
      tag: f.tag.trim().slice(0, 120),
      name: f.name!,
      mediaType,
      size: lstatSync(path).size,
      path
    };
  });
}
