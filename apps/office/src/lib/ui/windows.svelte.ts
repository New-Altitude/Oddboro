// The pane has its tabs, Odds, Office, Projects (in Advanced mode only) and
// Setup, and windows that open over them: hires, files, and reports opened
// from a staffer's chat once they have left the desk. Odds holds the desk and
// every Odd; Office holds goals, the layout, usage, lessons, the ledger and
// services, each a section that folds open in place; Projects fills its tab.
// Every open window stays mounted, so a drawing keeps going and a half-read
// file keeps its place while the owner works in another. Closing one with
// unsaved edits, or one still drawing, waits for the owner to say so.
import type { HireProposal } from '@oddboro/ledger';

export type FileRef = { staff: string; path: string; readOnly?: boolean };
export type ReportRef = { id: number; staff: string; title: string };
export type HireFrom = { askId: number; staff: string; proposal: HireProposal };
/** Which lessons the Lessons section shows: those for every Odd, those one Odd follows, or all. */
export type LessonsFilter = 'about' | 'all' | { staff: string };
/** A session to open in Projects. `n` bumps on every ask, so asking again for the same session still brings it up. */
export type ProjectAsk = { sessionId?: string; n: number };
export type Win =
  | { id: string; kind: 'hire'; from?: HireFrom }
  | { id: string; kind: 'file'; file: FileRef }
  | { id: string; kind: 'report'; report: ReportRef };

/** The tabs at the top of the pane. Projects shows only in Advanced mode. */
export type Tab = 'odds' | 'office' | 'projects' | 'setup';

export const wins = $state<{
  list: Win[];
  /** The window in front. None when the tab's own page is. */
  active?: string;
  /** The tab the pane shows when no window or Odd is in front. */
  tab: Tab;
  /** False when the owner folded the panel away: the windows stay open behind it. */
  shown: boolean;
  /**
   * True when a tab or window should sit above the Odd's panel. Opening a window,
   * clicking a tab and closing the Odd's panel set it; picking an Odd clears it.
   */
  raised: boolean;
  /** A window's own words for its tab, e.g. the name of the person being hired. */
  titles: Record<string, string>;
  dirty: Record<string, boolean>;
  busy: Record<string, boolean>;
  /** A close waiting on the owner's word, because the window has unsaved edits or is drawing. */
  confirm?: { id: string; go: () => void };
}>({ list: [], tab: 'odds', shown: false, raised: false, titles: {}, dirty: {}, busy: {} });

/**
 * Advanced mode, as this page last heard it (`+page.server.ts`, then Setup).
 * While it is off, nothing on the page offers Projects.
 */
export const advanced = $state({ on: false });

/**
 * An item a window wants opened on the desk, such as the task a service's
 * Change put there. The page takes it, reloads the desk and opens it.
 */
export const deskRequest = $state<{ focus?: string }>({});

/**
 * The sections that fold open in place: Waiting and Your Odds on the Odds tab,
 * the rest on the Office tab.
 */
export const FOLDS = [
  'waiting',
  'odds',
  'goals',
  'layout',
  'usage',
  'lessons',
  'ledger',
  'services'
] as const;
export type Fold = (typeof FOLDS)[number];
const TAB_OF = (f: Fold): Tab => (f === 'waiting' || f === 'odds' ? 'odds' : 'office');
/** Open at first: everything on the Odds tab, and Goals on the Office tab. */
const OPEN_AT_FIRST: Fold[] = ['waiting', 'odds', 'goals'];
const FOLDS_KEY = 'oddboro.pane.folds';

export const folds = $state<{
  open: Record<Fold, boolean>;
  /** A section asked to show itself. It scrolls into view, then clears this. */
  reveal?: Fold;
  /** Which lessons the Lessons section shows. */
  lessons: LessonsFilter;
  /** The session the Projects tab opens on. */
  project: ProjectAsk;
}>({
  open: Object.fromEntries(FOLDS.map((f) => [f, OPEN_AT_FIRST.includes(f)])) as Record<
    Fold,
    boolean
  >,
  lessons: 'about',
  project: { n: 0 }
});

/** Read which sections this viewer left open. The page calls it once, as it mounts. */
export function loadFolds(): void {
  try {
    const kept = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '{}') as Record<string, unknown>;
    for (const f of FOLDS) if (typeof kept[f] === 'boolean') folds.open[f] = kept[f];
  } catch {
    // Private window or nothing kept: the sections start as they do at first.
  }
}

export function setFold(id: Fold, on: boolean): void {
  folds.open[id] = on;
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(folds.open));
  } catch {
    // Private window: the section stays this way for this visit only.
  }
}

/** Bring a tab to the front of the pane, over any window or Odd. */
export function showTab(tab: Tab): void {
  wins.tab = tab;
  wins.active = undefined;
  wins.shown = true;
  wins.raised = true;
}

/** Open a section on its tab and scroll to it. */
export function openSection(id: Fold): void {
  setFold(id, true);
  showTab(TAB_OF(id));
  folds.reveal = id;
}

/** The window each one was opened from, so closing it goes back there, or to the tab. */
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

/** The Projects tab, on that session when one is named. Only in Advanced mode. */
export function openProject(sessionId?: string): void {
  if (!advanced.on) return;
  folds.project = { sessionId, n: folds.project.n + 1 };
  showTab('projects');
}

/** The Lessons section, on that filter. */
export function openLessons(filter: LessonsFilter = 'about'): void {
  folds.lessons = filter;
  openSection('lessons');
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
    // Back to the window it came from, else to the tab under it.
    const back = opener[id];
    wins.active = back && wins.list.some((w) => w.id === back) ? back : undefined;
  }
  delete opener[id];
}
