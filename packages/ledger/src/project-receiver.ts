// A fresh probe proves the paired tool server and monitor are both running.
// A file left by an earlier process is never proof that this session can listen.
import { readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const PROJECT_RECEIVERS = ['tools', 'monitor'] as const;
const probe = z.object({ key: z.string().uuid() });

// Start cannot know the id Claude Code gives a background session until it
// runs, so its plugin names this in place of a conversation id. The plugin
// loads into that one session only, so each plugin process pairs with its own.
export const PAIR_SELF = 'self';

/**
 * The conversation id a plugin process pairs with. For `PAIR_SELF` it is the
 * process's own session id, or none outside a Claude session, which pairs with
 * nothing.
 */
export function pairedSessionId(named: string) {
  return named === PAIR_SELF ? process.env.CLAUDE_CODE_SESSION_ID || undefined : named;
}

export function answerProjectProbes(box: string, receiver: (typeof PROJECT_RECEIVERS)[number]) {
  const answer = () => {
    try {
      const { key } = probe.parse(JSON.parse(readFileSync(join(box, 'probe.json'), 'utf8')));
      writeFileSync(join(box, key + '.' + receiver), '', { flag: 'wx', mode: 0o600 });
    } catch (e) {
      // No probe yet, or a repeated filesystem notice for the same probe.
      if (e instanceof Error && 'code' in e && (e.code === 'ENOENT' || e.code === 'EEXIST')) return;
      throw e;
    }
  };
  const watcher = watch(box, (_event, name) => {
    if (name === 'probe.json') answer();
  });
  watcher.on('error', (e) => {
    throw e;
  });
  answer();
  return watcher;
}
