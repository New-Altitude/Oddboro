// The windows open on the start side: the desk, the goals, the
// lessons (what the office knows about the owner), the ledger, hires, the office
// designer, the welcome and setup, files, and reports opened from a staffer's
// chat once they have left the desk.
// Every open window stays mounted, so a drawing keeps going and a half-read
// ask keeps its place while the owner works in another. Closing one with unsaved
// edits, or one still drawing, waits for the owner to say so.
import type { HireProposal } from '@oddboro/ledger';

export type FileRef = { staff: string; path: string; readOnly?: boolean };
export type ReportRef = { id: number; staff: string; title: string };
export type HireFrom = { askId: number; staff: string; proposal: HireProposal };
/** Which lessons the Lessons window shows: those for every Odd, those one Odd follows, or all. */
export type LessonsFilter = 'about' | 'all' | { staff: string };
export type Win =
  | { id: 'desk'; kind: 'desk' }
  | { id: 'goals'; kind: 'goals' }
  | { id: 'projects'; kind: 'projects'; sessionId?: string }
  | { id: 'lessons'; kind: 'lessons'; filter: LessonsFilter }
  | { id: 'ledger'; kind: 'ledger' }
  | { id: 'services'; kind: 'services' }
  | { id: 'office'; kind: 'office' }
  | { id: 'setup'; kind: 'setup' }
  | { id: string; kind: 'hire'; from?: HireFrom }
  | { id: string; kind: 'file'; file: FileRef }
  | { id: string; kind: 'report'; report: ReportRef };

export const wins = $state<{
  list: Win[];
  active?: string;
  /** False when the owner folded the panel away: the windows stay open behind it. */
  shown: boolean;
  /**
   * True when the front window should sit above the Odd's panel. Opening a window,
   * clicking its tab and closing the Odd's panel set it; picking an Odd clears it.
   */
  raised: boolean;
  /** A window's own words for its tab, e.g. the name of the person being hired. */
  titles: Record<string, string>;
  dirty: Record<string, boolean>;
  busy: Record<string, boolean>;
  /** A close waiting on the owner's word, because the window has unsaved edits or is drawing. */
  confirm?: { id: string; go: () => void };
}>({ list: [], shown: false, raised: false, titles: {}, dirty: {}, busy: {} });

/**
 * An item a window wants opened on the desk, such as the task a service's
 * Change put there. The page takes it, reloads the desk and opens it.
 */
export const deskRequest = $state<{ focus?: string }>({});

/** The window each one was opened from, so closing it goes back there. */
const opener: Record<string, string | undefined> = {};
let hires = 0;

export function open(w: Win): void {
  if (!wins.list.some((x) => x.id === w.id)) {
    wins.list.push(w);
    opener[w.id] = wins.active;
  }
  wins.active = w.id;
  wins.shown = true;
  wins.raised = true;
}

/** The one Projects window, on that session. Already open, it switches to it. */
export function openProject(sessionId: string): void {
  const w = wins.list.find((x) => x.kind === 'projects');
  if (w) w.sessionId = sessionId;
  open(w ?? { id: 'projects', kind: 'projects', sessionId });
}

/** The one Lessons window, on that filter. Already open, it switches to it. */
export function openLessons(filter: LessonsFilter = 'about'): void {
  const w = wins.list.find((x) => x.kind === 'lessons');
  if (w) w.filter = filter;
  open(w ?? { id: 'lessons', kind: 'lessons', filter });
}

export const openReport = (report: ReportRef) =>
  open({ id: `report:${report.id}`, kind: 'report', report });

export const openFile = (file: FileRef) =>
  open({
    id: `${file.readOnly ? 'reference' : 'file'}:${file.staff}:${file.path}`,
    kind: 'file',
    file
  });

/** A hire window: one per proposal, or a fresh one for a hire from scratch. */
export function openHire(from?: HireFrom): void {
  if (from) return open({ id: `hire:${from.askId}`, kind: 'hire', from });
  const blank = wins.list.find((w) => w.kind === 'hire' && !w.from);
  open(blank ?? { id: `hire:new-${++hires}`, kind: 'hire' });
}

export function close(id: string, force = false): void {
  if (!force && (wins.dirty[id] || wins.busy[id])) {
    wins.active = id;
    wins.shown = true;
    wins.confirm = { id, go: () => close(id, true) };
    return;
  }
  wins.list = wins.list.filter((w) => w.id !== id);
  delete wins.dirty[id];
  delete wins.busy[id];
  delete wins.titles[id];
  if (wins.confirm?.id === id) wins.confirm = undefined;
  if (wins.active === id) {
    const back = opener[id];
    wins.active = back && wins.list.some((w) => w.id === back) ? back : wins.list.at(-1)?.id;
  }
  delete opener[id];
  if (!wins.list.length) wins.shown = false;
}
