import type { ProjectAgent } from '@oddboro/ledger';
import { PROJECT_WORDS } from '../project-words.ts';

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
  /** The filter, the conversations found and Refresh list, or the line asking for a folder. */
  list: boolean;
  /** Refresh list at the end of the filter row, once a folder is set; without one, the form asks for it. */
  refresh: boolean;
  /** The Codex hand-over notice and its button, in place of the list. */
  handover: boolean;
  /** The running Codex server's socket. Start sends it too, so it serves both paths. */
  socket: boolean;
};

export function newSessionFields(form: {
  path: SessionPath | undefined;
  /** The Project folder as typed or chosen. */
  folder: string;
  agent: ProjectAgent;
  /** How many Claude folders are known, `~/.claude` included. */
  claudeFolders: number;
  /** A Codex conversation is waiting to be handed over. */
  handingOver: boolean;
}): NewSessionFields {
  const start = form.path === 'start';
  const handover = form.path === 'continue' && form.handingOver;
  const list = form.path === 'continue' && !handover;
  return {
    account: start && form.agent === 'claude' && form.claudeFolders > 1,
    start,
    list,
    refresh: list && !!form.folder.trim(),
    handover,
    socket: form.agent === 'codex'
  };
}

/** A conversation the continue path lists. Only Claude's carry a folder and its mark. */
export type Choice = {
  id: string;
  title: string;
  live: boolean;
  updated: number;
  job?: string;
  configDir?: string | null;
  mark?: string | null;
  /** The office can end it in its terminal and open it here (`PROJECT_WORDS.moveButton`). */
  movable?: boolean;
};

/**
 * Where a listed conversation is now: open in a terminal on this computer,
 * running, or saved and not running.
 */
export type ChoiceState = 'terminal' | 'running' | 'saved';

/**
 * A running Claude Code conversation with no background job is open in a
 * terminal; one with a job runs in Claude Code's background service. Codex
 * lists no jobs, so a running Codex conversation reads as running.
 */
export function choiceState(c: Pick<Choice, 'live' | 'job'>, agent: ProjectAgent): ChoiceState {
  if (!c.live) return 'saved';
  return agent === 'claude' && !c.job ? 'terminal' : 'running';
}

/** What a row says about where its conversation is. */
export const CHOICE_LABEL: Record<ChoiceState, string> = {
  terminal: PROJECT_WORDS.inTerminal,
  running: 'Running',
  saved: 'Saved'
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
 * Whether an error shows for what the form asks now. A list's error carries
 * the folder, tool and socket it asked about, and shows only while the form
 * asks the same, as the list's rows do (`rowsFor`). An error with no ask shows
 * whatever the form asks.
 */
export function errorShows(error: { ask?: ListAsk } | undefined, now: ListAsk): boolean {
  return !!error && (!error.ask || sameAsk(error.ask, now));
}

/**
 * The conversations to show for what the form asks now. Rows found for another
 * folder, tool or socket never show, however the folder changed (typed, Choose
 * folder or Reconnect), so a row never pairs one folder with another folder's
 * conversation. Undefined when nothing was listed for this ask.
 */
export function rowsFor(found: Found | undefined, now: ListAsk): Choice[] | undefined {
  return sameAsk(found?.ask, now) ? found?.rows : undefined;
}

/** The continue path's line while no folder is set, in place of the list. */
export const NO_FOLDER = 'Choose a project folder to see its conversations.';

/** What the owner did on the New session form that may list the folder's conversations. */
export type FormChange =
  /** Chose "Start a new conversation" or "Continue an earlier one". */
  | 'path'
  /** Typed in the Project folder or socket field, still in it. */
  | 'typed'
  /** Left the Project folder field after changing it, or picked a folder with Choose folder. */
  | 'folder'
  /** Switched the coding tool. */
  | 'tool'
  /** Picked another Claude folder in Account, which only Start uses. */
  | 'account'
  /** Pressed Refresh list. */
  | 'refresh';

/**
 * Whether a change lists the folder's conversations: only on the continue path
 * with a folder set, once per committed change, never per keystroke, never for
 * an Account change (a conversation found goes with its own) and never on a
 * timer. A change that leaves the ask as the newest list had it (the same
 * folder chosen again, Continue chosen with those rows shown or loading) lists
 * nothing. Refresh list lists on every press, except while a list for the same
 * ask still loads: the answer on its way is already the fresh one.
 */
export function lists(
  change: FormChange,
  form: {
    path: SessionPath | undefined;
    now: ListAsk;
    found: Found | undefined;
    /** What the newest list still loading asked about. */
    loading: ListAsk | undefined;
  }
): boolean {
  if (change === 'typed' || change === 'account') return false;
  if (form.path !== 'continue' || !form.now.folder.trim()) return false;
  if (form.loading) return !sameAsk(form.loading, form.now);
  return change === 'refresh' || !sameAsk(form.found?.ask, form.now);
}

/** How many lists the form has started, kept across lists. */
export type ListCount = { started: number };

/**
 * Lists the folder's conversations for `ask`. Its answer, rows or an error,
 * lands unless a newer list started after it, whatever the form asks by then.
 * The answer keeps the ask it answers, and `rowsFor` and `errorShows` show it
 * only while the form asks the same. So a slow list never lands over a newer
 * one, and an owner who edits the folder and comes back to it sees its rows
 * again with no new request.
 */
export async function listFor(
  ask: ListAsk,
  on: {
    /** The form's count of lists; this list takes the next number. */
    count: ListCount;
    find: (ask: ListAsk) => Promise<Choice[]>;
    /** The list starts: an earlier error clears, as when any other action starts. */
    start: () => void;
    found: (found: Found) => void;
    failed: (error: unknown, ask: ListAsk) => void;
  }
): Promise<void> {
  const n = ++on.count.started;
  on.start();
  let rows: Choice[];
  try {
    rows = await on.find(ask);
  } catch (e) {
    if (n === on.count.started) on.failed(e, ask);
    return;
  }
  if (n === on.count.started) on.found({ ask, rows });
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
  /** Listing the folder's conversations, on the continue path. */
  | 'continue'
  /** Opening a conversation from its row in the list. */
  | 'row'
  /** Handing a Codex conversation over, which has no row. */
  | 'handover'
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
  /** Directly under the row that was clicked, in the list. */
  | 'row'
  /** At the top of the form. */
  | 'top'
  /** Over the open session's terminal. */
  | 'session';

/**
 * Where an error shows: beside the control that caused it. A conversation that
 * would not open shows its error directly under its row, so it is in view
 * wherever that row sits in a long list; an error with no row (the list itself,
 * or a hand-over) shows above the rows. With a session open, the session pane
 * is all the owner sees, so every error shows there.
 */
export function errorPlace(source: ErrorSource, sessionOpen: boolean): ErrorPlace {
  if (sessionOpen) return 'session';
  switch (source) {
    case 'pick':
      return 'folder';
    case 'start':
      return 'start';
    case 'row':
      return 'row';
    case 'continue':
    case 'handover':
      return 'list';
    case 'load':
    case 'session':
      return 'top';
  }
}

/**
 * Whether typing in the filter clears the error shown: an error under a row
 * goes, as when any next action starts, so a row filtered out never takes its
 * error out of sight.
 */
export function filterClears(place: ErrorPlace | undefined): boolean {
  return place === 'row';
}
