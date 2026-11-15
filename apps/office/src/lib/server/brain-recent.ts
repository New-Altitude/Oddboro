// Stock Open Brain lists captures newest first, with their full text but without IDs.
import { createHash } from 'node:crypto';

const HEAD = 16;
const MAX_LIST = 1000;
export const textHash = (text: string) => createHash('sha256').update(text).digest('hex');

function listedTexts(reply: string, limit: number): string[] {
  if (reply === 'No thoughts found.') return [];
  const header = /^(\d+) recent thought\(s\):\n\n/.exec(reply);
  const rows = header ? reply.slice(header[0].length).split(/\n\n(?=\d+\. \[[^\]\n]+\] \()/) : [];
  if (!header || rows.length !== Number(header[1]) || rows.length > limit)
    throw new Error('Open Brain returned an unreadable list of recent captures.');
  return rows.map((row, i) => {
    const match = /^(\d+)\. \[[^\]\n]+\] \([^\n]*\)\n {3}([\s\S]*)$/.exec(row);
    if (!match || Number(match[1]) !== i + 1)
      throw new Error('Open Brain returned an unreadable recent capture.');
    return match[2];
  });
}

export async function recentCaptures(
  list: (limit: number) => Promise<string>,
  previous?: string[],
  total?: () => Promise<number>
) {
  const known = new Set(previous);
  let limit = HEAD;
  for (;;) {
    const texts = listedTexts(await list(limit), limit);
    const hashes = texts.map(textHash);
    const head = hashes.slice(0, HEAD);
    // Read past new arrivals to the previous window, even after a restart.
    // Overlapping entries also let one of the previous markers be removed.
    const overlap = hashes.findLastIndex((hash) => known.has(hash));
    if (!previous || overlap >= 0 || !texts.length) {
      const end = overlap >= 0 ? Math.max(overlap + 1, head.length) : texts.length;
      const added = texts.slice(0, end).filter((_, i) => !known.has(hashes[i]));
      return { head, added };
    }
    if (texts.length < limit || limit === MAX_LIST) {
      // A short list can also mean the server capped the response. Only the
      // source's total proves we saw everything when no previous marker remains.
      if (total && (await total()) === texts.length) return { head, added: texts };
      throw new Error(
        'Open Brain did not reach the last checked capture. The office kept its place because it could not verify the gap. It will resume when the Brain server offers paging.'
      );
    }
    limit = Math.min(limit * 2, MAX_LIST);
  }
}
