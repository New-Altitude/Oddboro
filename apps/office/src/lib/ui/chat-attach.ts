// The chat box's attachments before they go: how each is tagged, and the tag
// put in or taken out of the text. Pure, so the box stays thin.
import { isPicture, type ChatFile } from '#lib/attachments.ts';

/** One file in the tray over the paperclip. */
export type Pending = {
  key: number;
  /** How the message names it: "Image #1", or the file's own name. */
  tag: string;
  mediaType: string;
  size: number;
  /** Still on the owner's computer. */
  file?: File;
  /** Already kept in the Odd's attachments folder: a message taken back from waiting. */
  kept?: ChatFile;
  /** A picture's preview. */
  url?: string;
  /** Its tag sits in the text: deleting the tag drops the file. */
  inline: boolean;
};

const PASTED = /^Image #(\d+)$/;

/**
 * A pasted picture is "Image #N", numbered after every image already tagged,
 * as Claude Code does. A named file keeps its name, with " (2)" on a second
 * of the same name. Brackets never reach a tag, so a tag is always findable.
 */
export function tagFor(file: File, pasted: boolean, taken: string[]): string {
  if (pasted && isPicture(file.type)) {
    const n = Math.max(0, ...taken.map((t) => Number(PASTED.exec(t)?.[1] ?? 0)));
    return `Image #${n + 1}`;
  }
  const name = file.name.replace(/[[\]]/g, '').trim() || 'file';
  if (!taken.includes(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; ; i++) if (!taken.includes(`${stem} (${i})${ext}`)) return `${stem} (${i})${ext}`;
}

/** The text with tokens put in over the selection, spaced from their neighbours, and where the caret goes after them. */
export function withTokens(
  text: string,
  start: number,
  end: number,
  tags: string[]
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = !after || /^\s/.test(after) ? '' : ' ';
  const put = lead + tags.map((t) => `[${t}]`).join(' ') + trail;
  return { text: before + put + after, caret: (before + put).length };
}

/** The text with a file's token taken out, and one space beside it. */
export function withoutToken(text: string, tag: string): string {
  const token = `[${tag}]`;
  for (const t of [` ${token}`, `${token} `, token])
    if (text.includes(t)) return text.replace(t, '');
  return text;
}

export const hasToken = (text: string, tag: string) => text.includes(`[${tag}]`);
