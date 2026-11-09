/** The desktop allows 12 MiB on the wire for 8 MiB of originals in JSON. */
export const CHAT_BYTES = 8 * 1024 * 1024;
export const CHAT_REQUEST_BYTES = 12 * 1024 * 1024;
export const CHAT_FILES = 8;
export const CHAT_ACCEPT = '.txt,.md,.markdown,.png,.jpg,.jpeg,.webp';
export type ChatAttachment = { name: string; mediaType: string; size: number; hash: string };
export type ChatSource = { kind: string; id?: string; revision?: string };
export type OwnerInput = {
  turnId: string;
  message: string;
  source: ChatSource;
  files?: { name: string; bytes: Uint8Array }[];
};

/** getRandomValues also works at the owner's plain HTTP office address. */
export function newTurnId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(
    bytes,
    (b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0')
  ).join('');
}
