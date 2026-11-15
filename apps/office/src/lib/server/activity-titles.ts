import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Read recent display names only for conversations found open in a process. */
export async function activityTitles(
  ids: Set<string>,
  folder = process.env.CODEX_HOME || join(homedir(), '.codex')
) {
  const names: Record<string, string> = {};
  if (!ids.size) return names;
  const file = await open(
    join(folder, 'session_index.jsonl'),
    constants.O_RDONLY | constants.O_NONBLOCK
  ).catch(() => undefined);
  if (!file) return names;
  try {
    const info = await file.stat();
    if (!info.isFile()) return names;
    const { size } = info;
    const buffer = Buffer.alloc(Math.min(size, 512 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, size - buffer.length);
    for (const line of buffer.toString('utf8', 0, bytesRead).split('\n')) {
      try {
        const row = JSON.parse(line);
        if (row && ids.has(row.id) && typeof row.thread_name === 'string')
          names[row.id] = row.thread_name.slice(0, 160);
      } catch {
        /* A partial first or last line has no complete title. */
      }
    }
  } catch {
    /* A missing index or one replaced mid-read leaves the conversation ID as its label. */
  } finally {
    await file.close();
  }
  return names;
}
