import type { ProjectAgent } from '@oddboro/ledger';

// What the Projects window's New session form shows, and which conversations
// its filter keeps.
// The component only calls these, so each rule lives here once and its test
// drives it. Nothing here fetches.

/** The answer to "What would you like to do?". None until the owner picks. */
export type SessionPath = 'start' | 'continue';

/** Which parts of the New session form show. */
export type NewSessionFields = {
  /** The Account select, which picks the Claude folder a new conversation starts in. */
  account: boolean;
  /** Session name and the Start button. */
  start: boolean;
  /** Find existing, the filter and the conversations found. */
  list: boolean;
  /** The Codex hand-over notice and its button, in place of the list. */
  handover: boolean;
  /** The running Codex server's socket. Start sends it too, so it serves both paths. */
  socket: boolean;
};

export function newSessionFields(form: {
  path: SessionPath | undefined;
  agent: ProjectAgent;
  /** How many Claude folders are known, `~/.claude` included. */
  claudeFolders: number;
  /** A Codex conversation is waiting to be handed over. */
  handingOver: boolean;
}): NewSessionFields {
  const start = form.path === 'start';
  const handover = form.path === 'continue' && form.handingOver;
  return {
    account: start && form.agent === 'claude' && form.claudeFolders > 1,
    start,
    list: form.path === 'continue' && !handover,
    handover,
    socket: form.agent === 'codex'
  };
}

/** A conversation Find existing lists, as far as the filter reads it. */
export type Findable = { id: string; title: string; mark?: string | null };

/**
 * Whether a conversation stays in the list for what the owner typed: the
 * title or the account (folder and login) holding the words, or the id
 * starting with them, in any case. An empty box keeps every one.
 */
export function matchesFilter(c: Findable, typed: string): boolean {
  const q = typed.trim().toLowerCase();
  if (!q) return true;
  return (
    c.title.toLowerCase().includes(q) ||
    !!c.mark?.toLowerCase().includes(q) ||
    c.id.toLowerCase().startsWith(q)
  );
}
