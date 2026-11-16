import type { ProjectAgent } from '@oddboro/ledger';

// What the Projects window's New session form shows, which conversations its
// filter keeps, and where an error shows.
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

/** A conversation Find existing lists. Only Claude's carry a folder and its mark. */
export type Choice = {
  id: string;
  title: string;
  live: boolean;
  updated: number;
  job?: string;
  configDir?: string | null;
  mark?: string | null;
};
/** A Claude folder on the disk now, that a new conversation can start in. */
export type Folder = { path: string; mark: string };

/** What a list of conversations asks about: the folder, the tool and, for Codex, its socket. */
export type ListAsk = { folder: string; agent: ProjectAgent; socket: string | undefined };

/** The ask the form makes now. Only Codex sends a socket, and an empty one is none. */
export function listAsk(form: { folder: string; agent: ProjectAgent; socket: string }): ListAsk {
  return {
    folder: form.folder,
    agent: form.agent,
    socket: (form.agent === 'codex' && form.socket.trim()) || undefined
  };
}

export function sameAsk(a: ListAsk | undefined, b: ListAsk): boolean {
  return !!a && a.folder === b.folder && a.agent === b.agent && a.socket === b.socket;
}

/** Conversations a list found, with the ask they answer. */
export type Found = { ask: ListAsk; rows: Choice[] };

/**
 * The conversations to show for what the form asks now. Rows found for another
 * folder, tool or socket never show, however the folder changed (typed, Choose
 * folder or Reconnect), so a row never pairs one folder with another folder's
 * conversation. Undefined when nothing was listed for this ask.
 */
export function rowsFor(found: Found | undefined, now: ListAsk): Choice[] | undefined {
  return sameAsk(found?.ask, now) ? found?.rows : undefined;
}

/**
 * Whether a conversation stays in the list for what the owner typed: the
 * title or the account (folder and login) holding the words, or the id
 * starting with them, in any case. An empty box keeps every one.
 */
export function matchesFilter(c: Pick<Choice, 'id' | 'title' | 'mark'>, typed: string): boolean {
  const q = typed.trim().toLowerCase();
  if (!q) return true;
  return (
    c.title.toLowerCase().includes(q) ||
    !!c.mark?.toLowerCase().includes(q) ||
    c.id.toLowerCase().startsWith(q)
  );
}

/** What raised an error in the Projects window. */
export type ErrorSource =
  /** Choose folder. */
  | 'pick'
  /** Start, on the start path. */
  | 'start'
  /** Find existing, on the continue path. */
  | 'continue'
  /** Opening a conversation from the list, or handing one over. */
  | 'connect'
  /** Reading the sessions and Claude folders. */
  | 'load'
  /** Anything done on an open session. */
  | 'session';

/** Where an error shows. */
export type ErrorPlace =
  /** Under the Project folder field. */
  | 'folder'
  /** Under the Start button. */
  | 'start'
  /** Above the conversations found, under the filter. */
  | 'list'
  /** At the top of the form. */
  | 'top'
  /** Over the open session's terminal. */
  | 'session';

/**
 * Where an error shows: beside the control that caused it, so the owner never
 * has to scroll past a long list to find it. With a session open, the session
 * pane is all the owner sees, so every error shows there.
 */
export function errorPlace(source: ErrorSource, sessionOpen: boolean): ErrorPlace {
  if (sessionOpen) return 'session';
  switch (source) {
    case 'pick':
      return 'folder';
    case 'start':
      return 'start';
    case 'continue':
    case 'connect':
      return 'list';
    case 'load':
    case 'session':
      return 'top';
  }
}
