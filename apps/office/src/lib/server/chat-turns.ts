// The chat's append-only file and the owner's saved submissions. A turn is
// kept before a runner starts. Uploads and imports use the same attachments
// folder and ChatFile records as an older office's messages.
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { home, OFFICE_FILES, staffer } from '@oddboro/ledger';
import { attachableType, FILES_MAX, refusal, type ChatFile } from '#lib/attachments.ts';
import { CHAT_BYTES, type OwnerInput } from '#lib/staff/chat-input.ts';
import type { ChatEntry, ChatRef } from '#lib/staff/chat.ts';
import { attachedFiles, keepAttachment } from './chat-files.ts';
import { replyBrief } from './chat-delivery.ts';
import { emit } from './events.ts';

export class ChatInputError extends Error {}

export const chatFile = (id: string) => home('staff', id, OFFICE_FILES.chat);

export function addToChat(id: string, line: ChatEntry): void {
  mkdirSync(home('staff', id), { recursive: true });
  appendFileSync(chatFile(id), JSON.stringify(line) + '\n');
}

export function history(id: string): ChatEntry[] {
  const file = chatFile(id);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatEntry);
}

/** Refuse mislabeled inline imports before any part of the turn is saved. */
function inlineType(name: string, bytes: Uint8Array): string {
  const type = attachableType(name, '');
  const why = refusal(name, '', bytes.byteLength);
  if (!type || why) throw new ChatInputError(why ?? 'Choose a picture, PDF or text file.');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const starts = (hex: string) => data.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const matches =
    type === 'image/png'
      ? starts('89504e470d0a1a0a')
      : type === 'image/jpeg'
        ? starts('ffd8ff')
        : type === 'image/gif'
          ? /^GIF8[79]a/.test(data.toString('ascii', 0, 6))
          : type === 'image/webp'
            ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
            : type === 'application/pdf'
              ? data.toString('ascii', 0, 5) === '%PDF-'
              : !data.includes(0) && isUtf8(data);
  if (!matches) throw new ChatInputError(`${name} does not contain the file type its name says.`);
  return type;
}

/** Save an exact submission once. No await separates the lookup and append. */
export async function keepOwnerTurn(
  id: string,
  input: OwnerInput,
  replyTo?: Pick<ChatRef, 'kind' | 'id'>
): Promise<ChatEntry> {
  const { turnId, message, source, files = [] } = input;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(turnId))
    throw new ChatInputError('This message has no valid ID.');
  if (
    !source.kind ||
    source.kind.length > 80 ||
    (source.id?.length ?? 0) > 500 ||
    (source.revision?.length ?? 0) > 500
  )
    throw new ChatInputError('This message has no valid source.');
  if (!(await staffer(id))) throw new ChatInputError('No such Odd');
  const re = replyTo ? (await replyBrief(id, replyTo)).ref : undefined;
  const kept = attachedFiles(id, input.kept).map(({ path: _, ...f }) => f);
  if (!message.trim() && !files.length && !kept.length)
    throw new ChatInputError('Write a message or attach a file.');
  if (files.length + kept.length > FILES_MAX)
    throw new ChatInputError(`Attach up to ${FILES_MAX} files at a time.`);
  if (Buffer.byteLength(message) + files.reduce((sum, f) => sum + f.bytes.length, 0) > CHAT_BYTES)
    throw new ChatInputError(
      'Use up to 8 MiB of text and inline files per message. Upload larger files first.'
    );
  const inline = files.map(({ name, bytes }) => {
    if (!name.trim() || name.length > 200 || /[\\/\p{Cc}]/u.test(name))
      throw new ChatInputError('Give the file a short name without a folder.');
    return {
      name,
      mediaType: inlineType(name, bytes),
      hash: createHash('sha256').update(bytes).digest('hex')
    };
  });
  const inputHash = createHash('sha256')
    .update(
      JSON.stringify({ message, source, re: re && { kind: re.kind, id: re.id }, inline, kept })
    )
    .digest('hex');
  const old = history(id).find((e) => e.from === 'owner' && e.turnId === turnId);
  if (old) {
    if (old.inputHash !== inputHash)
      throw new ChatInputError('This message ID already belongs to another message.');
    return old;
  }
  const attached: ChatFile[] = [
    ...kept,
    ...inline.map((f, i) => ({
      ...keepAttachment(id, f.name, f.mediaType, files[i].bytes),
      tag: f.name
    }))
  ];
  const line: ChatEntry = {
    at: new Date().toISOString(),
    from: 'owner',
    text: message,
    turnId,
    source,
    inputHash,
    ...(re ? { re } : {}),
    ...(attached.length ? { files: attached } : {})
  };
  addToChat(id, line);
  emit({ type: 'change', table: 'chat' });
  return line;
}
