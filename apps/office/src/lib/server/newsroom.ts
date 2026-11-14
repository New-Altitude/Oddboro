// One public edition per office. The office clock and the owner's actions share
// a queue so a slow download cannot undo Remove or overwrite a changed setting.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { home } from '@oddboro/ledger/home';
import { personaOdd } from '@oddboro/ledger';
import { nextRun, officeDay, wallClock } from '@oddboro/ledger/time';
import {
  editionSchema,
  preferences,
  publicationGroups,
  todayStories,
  type Command,
  type NewsroomView
} from '../newsroom/edition.ts';
import { emit } from './events.ts';
import { notifyMac } from './notify.ts';
import type { ChatEntry } from '../staff/chat.ts';

const publisher = 'https://www.natebjones.com/api/newsroom';
const interval = 10 * 60_000;
type State = NewsroomView & {
  next: number;
  etag?: string;
  brief?: string;
  groups: string[];
  introductions?: Record<
    string,
    { at: string; staff: string; posts: NonNullable<NewsroomView['edition']>['publications'] }
  >;
  seen: Record<string, number>;
  pending: string[];
};
const fresh = (): State => ({
  prefs: preferences.parse({}),
  marks: {},
  kept: [],
  notices: [],
  groups: [],
  seen: {},
  pending: [],
  paused: false,
  next: 0
});
let state: State | undefined;
function read(): State {
  const file = home('newsroom.json');
  return (state ??= existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as State) : fresh());
}
function keep(s: State) {
  mkdirSync(home(), { recursive: true });
  const file = home('newsroom.json');
  writeFileSync(file + '.tmp', JSON.stringify(s), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  state = s;
  emit({ type: 'newsroom', unread: unreadNews(s) });
}
export function unreadNews(s: State = read()): number {
  return s.notices.filter((n) => !s.lastVisit || n.at > s.lastVisit).length;
}
// The edition and chat references commit together. A correction changes the displayed
// reference, including in an older chat. A withdrawn piece loses its link.
export function newsroomChat(staff: string): ChatEntry[] {
  const s = read();
  return Object.values(s.introductions ?? {})
    .filter((i) => i.staff === staff)
    .map((i) => {
      const lines = i.posts.map((p) =>
        p.withdrawn ? p.title + ' (withdrawn)' : p.title + '\n' + p.url
      );
      return {
        at: i.at,
        from: 'staff',
        text: 'New from ' + (s.edition?.byline || 'the publisher') + ':\n' + lines.join('\n')
      };
    });
}
let waiting = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = waiting.then(work);
  waiting = next.then(
    () => {},
    () => {}
  );
  return next;
}
async function connected(s: State) {
  if (!s.edition) return;
  const odd = await personaOdd(s.edition.persona);
  return odd?.package && !odd.package.quiet ? odd.id : undefined;
}
export async function newsroomView(): Promise<NewsroomView> {
  const { edition, prefs, marks, kept, notices, lastVisit, paused, problem } = read();
  return {
    edition,
    prefs,
    marks,
    kept,
    notices,
    lastVisit,
    paused,
    problem,
    staff: await connected(read())
  };
}

async function latest(s: State, now: Date) {
  const reply = await fetch(publisher, {
    redirect: 'error',
    credentials: 'omit',
    headers: s.etag ? { 'if-none-match': s.etag } : {},
    signal: AbortSignal.timeout(8000)
  });
  s.next = now.getTime() + interval;
  if (reply.status === 304 && s.edition) {
    delete s.problem;
    return;
  }
  if (!reply.ok || !reply.body) throw new Error('The publisher did not send an edition.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of reply.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw new Error('The edition was too large.');
    chunks.push(chunk);
  }
  const edition = editionSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (s.edition && Date.parse(edition.updated) < Date.parse(s.edition.updated))
    throw new Error('The publisher returned an older edition.');
  const first = !s.edition;
  for (const story of edition.stories) {
    const old =
      s.edition?.stories.find((v) => v.id === story.id) ?? s.kept.find((v) => v.id === story.id);
    const mark = s.marks[story.id];
    if (mark?.saved || mark?.followed) s.kept = [...s.kept.filter((v) => v.id !== story.id), story];
    if (first || (old && story.revision <= old.revision)) continue;
    const correction = story.alert === 'correction' && !!s.seen[story.id];
    if (
      correction ||
      (!mark?.muted && (mark?.followed || (s.prefs.delivery === 'alerts' && story.alert)))
    ) {
      if (!s.pending.includes(story.id)) s.pending.push(story.id);
    }
  }
  s.etag = reply.headers.get('etag') ?? undefined;
  s.edition = edition;
  delete s.problem;
  if (first) {
    s.brief = officeDay(now);
    for (const item of edition.stories) s.seen[item.id] = item.revision;
    s.groups = edition.publications.map((p) => p.group);
    s.lastVisit = now.toISOString();
  }
}
function clockTime(now: Date) {
  const { h, min } = wallClock(now);
  return [h, min].map((n) => String(n).padStart(2, '0')).join(':');
}
async function deliver(s: State, now: Date) {
  const e = s.edition;
  if (!e) return;
  const p = s.prefs;
  const time = clockTime(now);
  const quiet =
    p.quietStart > p.quietEnd
      ? time >= p.quietStart || time < p.quietEnd
      : time >= p.quietStart && time < p.quietEnd;
  if (quiet) return;
  const notices: State['notices'] = [];
  function add(key: string, text: string) {
    if (!s.notices.some((n) => n.key === key)) notices.push({ key, text, at: now.toISOString() });
  }
  const day = officeDay(now);
  const lead = todayStories(e, p, s.marks)[0];
  if (p.delivery !== 'read' && e.day === day && time >= p.briefTime && s.brief !== day && lead) {
    add('brief-' + day, lead.title);
    s.brief = day;
  }
  for (const id of s.pending) {
    const story = e.stories.find((v) => v.id === id);
    if (!story) continue;
    const correction = story.alert === 'correction' && !!s.seen[id];
    if (!correction && (s.marks[id]?.muted || (!s.marks[id]?.followed && p.delivery !== 'alerts')))
      continue;
    add(id + '-' + story.revision, story.alertText || story.title);
  }
  s.pending = [];
  const groups = publicationGroups(e, p);
  const newGroups = groups.filter((g) => !s.groups.includes(g[0].group));
  if (newGroups.length && p.creator === 'chat') {
    const staff = await connected(s);
    if (staff) {
      const intros = (s.introductions ??= {});
      for (const posts of newGroups) {
        const group = posts[0].group;
        intros[group] ??= { at: now.toISOString(), staff, posts };
      }
    }
  }
  for (const [group, intro] of Object.entries(s.introductions ?? {})) {
    const updated = new Map(intro.posts.map((p) => [p.id, p]));
    for (const p of e.publications)
      if (p.group === group && (updated.has(p.id) || s.prefs.channels.includes(p.channel)))
        updated.set(p.id, p);
    intro.posts = [...updated.values()];
  }
  s.groups = [...new Set([...s.groups, ...e.publications.map((v) => v.group)])].slice(-1500);
  s.notices = [...notices.reverse(), ...s.notices].slice(0, 60);
  if (notices.length) {
    keep(s);
    if (p.desktop)
      await notifyMac(
        e.name,
        notices.length === 1
          ? notices[0].text
          : notices.length + ' newsroom updates. ' + notices[0].text
      );
  }
}

async function sweep(s: State, now: Date) {
  try {
    await latest(s, now);
  } catch {
    if (!s.edition)
      throw new Error('The newsroom could not load its first edition. Try Add again.');
    s.problem = 'The publisher could not be reached. Showing the last edition.';
    s.next = now.getTime() + interval;
  }
}
export function newsroomAction(c: Command) {
  return serial(async () => {
    const s = structuredClone(read());
    const now = new Date();
    if (c.op === 'remove') {
      keep(fresh());
      return;
    }
    if (c.op === 'add' && s.edition) return;
    if (!s.edition && c.op !== 'add') throw new Error('Add the newsroom first.');
    if (c.op === 'add' || c.op === 'refresh' || (c.op === 'pause' && !c.on)) await sweep(s, now);
    if (c.op === 'preferences') s.prefs = c.prefs;
    if (c.op === 'pause') s.paused = c.on;
    if (c.op === 'visit') {
      s.lastVisit = now.toISOString();
      for (const item of s.edition?.stories ?? []) s.seen[item.id] = item.revision;
    }
    if (c.op === 'mark') {
      const story =
        s.edition?.stories.find((v) => v.id === c.id) ?? s.kept.find((v) => v.id === c.id);
      if (!story) throw new Error('That story is no longer available.');
      const mark = (s.marks[c.id] = { ...s.marks[c.id], [c.mark]: c.on });
      s.kept = s.kept.filter((v) => v.id !== c.id);
      if (mark.saved || mark.followed) s.kept.push(story);
    }
    if (!s.paused) await deliver(s, now);
    keep(s);
  });
}
export function newsroomClock(now: Date): Promise<number> {
  return serial(async () => {
    const old = read();
    if (!old.edition || old.paused) return Infinity;
    const s = structuredClone(old);
    const before = JSON.stringify(s);
    if (now.getTime() >= s.next) await sweep(s, now);
    await deliver(s, now);
    if (JSON.stringify(s) !== before) keep(s);
    return Math.min(
      s.next,
      nextRun({ every: 'day', at: s.prefs.briefTime }, now).getTime(),
      nextRun({ every: 'day', at: s.prefs.quietEnd }, now).getTime()
    );
  });
}
