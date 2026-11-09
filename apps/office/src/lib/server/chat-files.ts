// The office keeps the originals outside the folders an Odd may change. The
// name is for the owner. Only the hash and a known suffix name a file on disk.
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replace } from './launch.ts';
import { home } from '@oddboro/ledger';
import {
  CHAT_BYTES,
  CHAT_FILES,
  CHAT_ID,
  type ChatAttachment,
  type OwnerInput
} from '../staff/chat-input.ts';

export class ChatInputError extends Error {}

const suffix: Record<string, string> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

function media(name: string, data: Buffer): string {
  if (/\.(txt|md|markdown)$/i.test(name) && !data.includes(0) && isUtf8(data))
    return /\.txt$/i.test(name) ? 'text/plain' : 'text/markdown';
  if (/\.png$/i.test(name) && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (/\.jpe?g$/i.test(name) && data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')))
    return 'image/jpeg';
  if (
    /\.webp$/i.test(name) &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new ChatInputError('Choose a Markdown or UTF-8 text file, or a PNG, JPEG or WebP picture.');
}

export function checkInput({ turnId, message, source, files = [] }: OwnerInput): ChatAttachment[] {
  if (!CHAT_ID.test(turnId)) throw new ChatInputError('This message has no valid ID.');
  if (!message.trim() && !files.length)
    throw new ChatInputError('Write a message or attach a file.');
  if (
    !source.kind ||
    source.kind.length > 80 ||
    (source.id?.length ?? 0) > 500 ||
    (source.revision?.length ?? 0) > 500
  )
    throw new ChatInputError('This message has no valid source.');
  if (
    files.length > CHAT_FILES ||
    files.reduce((sum, f) => sum + f.bytes.length, Buffer.byteLength(message)) > CHAT_BYTES
  )
    throw new ChatInputError('Use up to 8 files and 8 MiB of text and files per message.');
  return files.map(({ name, bytes }) => {
    if (!name.trim() || name.length > 200 || /[\\/\p{Cc}]/u.test(name))
      throw new ChatInputError('Give the file a short name without a folder.');
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      name,
      mediaType: media(name, data),
      size: bytes.length,
      hash: createHash('sha256').update(data).digest('hex')
    };
  });
}

export function attachmentPath(id: string, file: ChatAttachment): string {
  if (
    !/^[a-z0-9-]+$/.test(id) ||
    !/^[0-9a-f]{64}$/.test(file.hash) ||
    !Object.hasOwn(suffix, file.mediaType)
  )
    throw new ChatInputError('No such attachment.');
  return join(home('chat-files', id), file.hash + '.' + suffix[file.mediaType]);
}

export function keepFiles(
  id: string,
  refs: ChatAttachment[],
  files: NonNullable<OwnerInput['files']>
) {
  if (!refs.length) return;
  mkdirSync(home('chat-files', id), { recursive: true, mode: 0o700 });
  refs.forEach((ref, i) => {
    const path = attachmentPath(id, ref);
    if (!existsSync(path)) replace(path, files[i].bytes);
  });
}

export function inputFiles(id: string, refs: ChatAttachment[]) {
  const texts: string[] = [];
  const images: { path: string; mediaType: string }[] = [];
  for (const file of refs) {
    const path = attachmentPath(id, file);
    if (file.mediaType.startsWith('image/')) images.push({ path, mediaType: file.mediaType });
    else texts.push(`Attached file: ${file.name}\n${readFileSync(path, 'utf8')}`);
  }
  return { texts, images };
}
