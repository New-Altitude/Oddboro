// Files the owner attaches to a chat message. Shared by the page, which picks
// and previews them, and the server, which keeps them in the Odd's attachments folder.

/** What an Odd's tools can open, by extension: pictures, PDFs and plain text. */
export const ATTACHABLE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json'
};

/** The extension a picture pasted with no name gets, from its type. */
const PICTURE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/** The file picker's filter. */
export const ACCEPT = Object.keys(ATTACHABLE)
  .map((e) => `.${e}`)
  .join(',');

export const FILE_MAX = 10 * 1024 * 1024;
export const FILES_MAX = 10;

/** One attachment on a message, as the chat keeps it. */
export type ChatFile = {
  /** How the message names it: "Image #1", or the file's own name. */
  tag: string;
  /** The file's name in the Odd's `attachments/` folder. */
  name: string;
  mediaType: string;
  size: number;
};

/** The media type of a file the office takes, by its name, else its type; undefined for any other. */
export function attachableType(name: string, type: string): string | undefined {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return ATTACHABLE[ext] ?? (PICTURE_EXT[type] ? type : undefined);
}

/** The extension to keep a file under, so every tool reads it by its name. */
export function extensionFor(name: string, mediaType: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return ATTACHABLE[ext] ? ext : (PICTURE_EXT[mediaType] ?? 'bin');
}

export const isPicture = (mediaType: string) => mediaType.startsWith('image/');

/** The words that turn a file away, or undefined when the office takes it. */
export function refusal(name: string, type: string, size: number): string | undefined {
  if (!attachableType(name, type))
    return `${name || 'That file'} can't go to an Odd. Attach a picture, a PDF or a text file.`;
  if (size > FILE_MAX) return `${name} is over 10 MB.`;
  if (size === 0) return `${name} is empty.`;
  return undefined;
}

/** The size in words: "840 KB", "2.4 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
