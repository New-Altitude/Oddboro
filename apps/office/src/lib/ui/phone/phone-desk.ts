// The phone's own Desk list: which items it shows, in what order, and which
// buttons each card gets. Safe to import in the browser.
//
// A one-tap button posts to the same route, with the same body, as the
// matching button in `DeskDrawer.svelte`, so the server takes it exactly as a
// yes or a no from the computer. A card whose yes may send something outside
// the office gets Open only, so the owner sees it in full before saying yes.
import type { AskKind, AskRow, Desk, ReportRow, TaskRow } from '@oddboro/ledger';
import { mustDo } from '#lib/ui/task-steps.ts';

/** One item on the desk, by kind, as the phone lists it. */
export type DeskCard =
  | { kind: 'ask'; key: string; row: AskRow }
  | { kind: 'task'; key: string; row: TaskRow }
  | { kind: 'report'; key: string; row: ReportRow };

export type Chip = 'all' | 'asks' | 'tasks' | 'reports';
export const CHIPS: { id: Chip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'asks', label: 'Asks' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'reports', label: 'Reports' }
];

/** A button on a card: Open, a one-tap answer, or one that opens a chat. */
export type CardButton =
  | { id: 'open'; label: 'Open' }
  | { id: 'deny'; label: string; post: Post }
  | { id: 'yes'; label: string; post: Post }
  | { id: 'read'; label: 'Read'; post: Post }
  | { id: 'reply'; label: 'Reply' };

/** The route and body a one-tap button posts, as the drawer's button does. */
export type Post = { url: `/api/${string}`; body: Record<string, unknown> };

const answer = (a: AskRow, decision: 'approve' | 'deny'): Post => ({
  url: `/api/asks/${a.id}`,
  body: { decision, reason: '', report: false }
});
const OPEN = { id: 'open', label: 'Open' } as const;
const deny = (a: AskRow, label = 'Deny'): CardButton => ({
  id: 'deny',
  label,
  post: answer(a, 'deny')
});
const yes = (a: AskRow, label: string): CardButton => ({
  id: 'yes',
  label,
  post: answer(a, 'approve')
});

/**
 * Whether a held call's yes may send something outside the office. Only a
 * Gmail call the office put in words (`said`, from `heldWords`) is known to
 * stay in: it labels, archives or moves mail already in the owner's Gmail.
 * The phone cannot tell what any other call does, so it counts as one that
 * sends.
 */
export const sendsOut = (a: AskRow): boolean => !a.call?.said;

/** The buttons on an ask's card, by kind. A kind with its own review gets Open only. */
export function askButtons(a: AskRow): CardButton[] {
  const kind: AskKind = a.kind;
  switch (kind) {
    case 'approval':
      return [deny(a), OPEN, yes(a, 'Approve')];
    case 'call':
      return sendsOut(a)
        ? [OPEN]
        : [
            deny(a),
            OPEN,
            {
              id: 'yes',
              label: 'Make this call',
              post: { url: `/api/asks/${a.id}/call`, body: {} }
            }
          ];
    case 'switch':
      return [deny(a), OPEN, yes(a, 'Turn on')];
    case 'window':
      return [deny(a, 'Pause it'), yes(a, 'Let it carry on')];
    case 'access':
    case 'hire':
    case 'goal':
    case 'plan':
    case 'hand_offs':
    case 'reply':
    case 'filter':
    case 'folder':
    case 'remove':
    case 'bring_back':
    case 'level':
    case 'catch_up':
    case 'office_tool':
    case 'standing':
      return [OPEN];
    default: {
      const missed: never = kind;
      throw new Error(`No phone card for a ${String(missed)} ask`);
    }
  }
}

/** The buttons on any card. */
export function cardButtons(c: DeskCard): CardButton[] {
  if (c.kind === 'ask') return askButtons(c.row);
  if (c.kind === 'task') return [OPEN];
  return [
    { id: 'reply', label: 'Reply' },
    { id: 'read', label: 'Read', post: { url: `/api/reports/${c.row.id}`, body: {} } }
  ];
}

const newestFirst = (a: DeskCard, b: DeskCard) =>
  new Date(b.row.createdAt).getTime() - new Date(a.row.createdAt).getTime();

/** Every item on the desk, or one kind of them, newest first. */
export function deskCards(d: Desk, chip: Chip = 'all'): DeskCard[] {
  const asks: DeskCard[] = d.asks.map((row) => ({ kind: 'ask', key: `ask-${row.id}`, row }));
  const tasks: DeskCard[] = d.tasks.map((row) => ({ kind: 'task', key: `task-${row.id}`, row }));
  const reports: DeskCard[] = d.reports.map((row) => ({
    kind: 'report',
    key: `report-${row.id}`,
    row
  }));
  const pick = { all: [...asks, ...tasks, ...reports], asks, tasks, reports }[chip];
  return pick.sort(newestFirst);
}

/** How many items each chip shows. */
export const chipCounts = (d: Desk): Record<Chip, number> => ({
  all: d.asks.length + d.tasks.length + d.reports.length,
  asks: d.asks.length,
  tasks: d.tasks.length,
  reports: d.reports.length
});

/** Home's Waiting on you: what needs a yes or no, which is the asks, held calls among them. Newest first. */
export const waitingOnYou = (d: Desk): DeskCard[] => deskCards(d, 'asks');

/** A card's kind in a word or two, for its label. */
export const kindWord = (c: DeskCard): string =>
  c.kind === 'ask'
    ? c.row.kind === 'call'
      ? 'Held call'
      : 'Ask'
    : c.kind === 'task'
      ? 'Task'
      : 'Report';

/**
 * A task's progress: "1 of 3 steps done", how far along as a fraction, and
 * whether the next step that holds it up is a sign-in, which happens at the
 * office's computer.
 */
export function taskProgress(t: TaskRow): { line: string; done: number; signIn: boolean } {
  const total = t.steps.length;
  const done = t.steps.filter((s) => s.done).length;
  const next = t.steps.find((s) => mustDo(s) && !s.done);
  return {
    line: `${done} of ${total} ${total === 1 ? 'step' : 'steps'} done`,
    done: total ? done / total : 0,
    signIn: next?.action?.kind === 'oauth' || next?.action?.kind === 'aws'
  };
}

/** The line under a card's title: why an ask was raised, or a report's first line. */
export function cardLine(c: DeskCard): string {
  const text = c.kind === 'report' ? c.row.body : c.row.why;
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^#+\s*/, '').trim();
}
