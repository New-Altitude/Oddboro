// Where each Odd should live, as the office recommends it. One run as the
// office reads every room an Odd can live in (its kind, its seats and who is
// there) and each Odd's role and remit, and says which room fits each and
// why. The office then gives each Odd a seat there: the one it has when its
// room stays the same, else the first free one. An answer that names no real
// room, or a run that fails, falls back to the plain rules (`suggestHome`),
// so the owner always gets a home to accept or change.
import { runAsOffice } from './office-run.ts';
import { suggestHome, type HomeRoom } from '../staff/home.ts';

/** An Odd to place: one on staff by id, or the hire being made (`new`). */
export type Placing = { id: string; name: string; role: string; remit: string };
/** Someone who lives in the office now. */
type Resident = { id: string; name: string; role: string; room: string; seat?: string | null };

export type HomeAdvice = {
  id: string;
  room: string;
  seat?: string;
  why: string;
  /** Who said it: the office's run, or the plain rules when the run gave nothing for this Odd. */
  by: 'office' | 'rules';
};

const SYSTEM = `You place Odds, the AI workers in {owner}'s Oddboro office, in the rooms they live and work in. A good home puts an Odd where its kind of work happens and next to the Odds it works with most: a product team together, research by the books, intake by the mail. A wing is a part of {owner}'s life, like Work, School or Hobbies: put an Odd in the wing its work belongs to. Use only the rooms you are given. Reply with JSON only.`;

/** The kind of room a template is, by its id: `mail-room` is mail. */
const kindOf = (room: string) => room.split('-')[0];

function message(odds: Placing[], rooms: HomeRoom[], residents: Resident[]): string {
  const roomLines = rooms.map((r) => {
    const free = r.seats.filter((s) => !s.owner).length;
    const who = residents
      .filter((p) => p.room === r.id && !odds.some((o) => o.id === p.id))
      .map((p) => `${p.name} (${p.role})`);
    const wing = r.wing ? ` in the ${r.wing} wing` : ', common space';
    return `- id "${r.id}": ${r.name}, a ${kindOf(r.id)} room${wing}, ${r.seats.length} seats, ${free} free${who.length ? `. Lives here: ${who.join(', ')}` : ''}`;
  });
  const oddLines = odds.map(
    (o) => `- id "${o.id}": ${o.name}, ${o.role}. ${o.remit || 'No remit yet.'}`
  );
  return `Recommend a home for each Odd below.

## Rooms

${roomLines.join('\n')}

## Odds to place

${oddLines.join('\n')}

Put Odds whose work goes together in the same room when it has the seats. Keep an Odd where it is when that room already fits it. Each "why" is one short sentence {owner} reads: plain words, no em-dashes, naming who it sits with when that is the reason. Call each Odd by its name or "it", never he or she.

Reply with only this JSON:
{"homes": [{"odd": "<odd id>", "room": "<room id>", "why": "<one sentence>"}]}`;
}

/** The rooms the run picked, by Odd id, keeping only real rooms. */
function parse(text: string, rooms: HomeRoom[]): Map<string, { room: string; why: string }> {
  const out = new Map<string, { room: string; why: string }>();
  // The last whole answer counts: a run sometimes corrects a first try in the same reply.
  const starts = [...text.matchAll(/\{\s*"homes"/g)].map((m) => m.index).reverse();
  const ends = [...text.matchAll(/\}/g)].map((m) => m.index).reverse();
  let homes: Record<string, unknown>[] = [];
  find: for (const a of starts)
    for (const e of ends) {
      if (e < a) break;
      try {
        const v = (JSON.parse(text.slice(a, e + 1)) as { homes?: unknown }).homes;
        if (Array.isArray(v)) {
          homes = v as Record<string, unknown>[];
          break find;
        }
      } catch {
        // Not a whole answer from here to there: try a shorter one.
      }
    }
  for (const h of homes) {
    if (typeof h.odd !== 'string' || typeof h.room !== 'string') continue;
    if (!rooms.some((r) => r.id === h.room)) continue;
    const why = typeof h.why === 'string' ? h.why.trim().slice(0, 240) : '';
    out.set(h.odd, { room: h.room, why: why || 'A room that fits the work.' });
  }
  return out;
}

/**
 * A home for each Odd in `odds`, from one office run. Seats are handed out in
 * order: an Odd staying in its room keeps its seat, the rest take free ones,
 * and no two get the same seat. `note` says, for the owner, why the office's
 * own picks are missing when the rules filled in for every Odd.
 */
export async function recommendHomes(
  odds: Placing[],
  rooms: HomeRoom[],
  residents: Resident[]
): Promise<{ homes: HomeAdvice[]; note?: string }> {
  if (!odds.length || !rooms.length) return { homes: [] };
  const r = await runAsOffice(message(odds, rooms, residents), {
    system: SYSTEM,
    kind: 'office',
    effort: 'low',
    timeoutMs: 3 * 60_000
  });
  const picked = r.ok ? parse(r.text, rooms) : new Map<string, { room: string; why: string }>();
  // The owner still gets the rules' homes; the log says why the office's are missing.
  if (!r.ok) console.error(`[homes] the office run failed: ${r.text.slice(0, 300)}`);
  else if (picked.size < odds.length)
    console.error(
      `[homes] the office placed ${picked.size} of ${odds.length}: ${r.text.slice(0, 300)}`
    );
  // Seats held by Odds not being placed stay theirs.
  const held = new Set(
    residents.filter((p) => p.seat && !odds.some((o) => o.id === p.id)).map((p) => p.seat!)
  );
  const plans = odds.map((o) => {
    const advice = picked.get(o.id);
    if (advice) return { o, room: advice.room, why: advice.why, by: 'office' as const };
    // With no word from the office, an Odd that has a home keeps it.
    const now = residents.find((x) => x.id === o.id);
    if (now && rooms.some((r) => r.id === now.room))
      return { o, room: now.room, why: 'Stays where it lives now.', by: 'rules' as const };
    const rule = suggestHome(o, rooms, residents);
    return { o, room: rule?.room ?? rooms[0].id, why: rule?.why ?? '', by: 'rules' as const };
  });
  // First, everyone who stays in the room they have keeps the seat they have.
  const seatOf = new Map<string, string>();
  for (const p of plans) {
    const now = residents.find((x) => x.id === p.o.id);
    if (now?.seat && now.room === p.room && !held.has(now.seat)) {
      seatOf.set(p.o.id, now.seat);
      held.add(now.seat);
    }
  }
  const said = r.text.trim().split('\n')[0].slice(0, 120);
  const note = picked.size
    ? undefined
    : r.ok && r.text.includes('{')
      ? 'The office named no room on this floor, so these come from simple rules by role.'
      : `The office could not answer${said ? ` (${said})` : ''}, so these come from simple rules by role.`;
  const homes = plans.map((p) => {
    let seat = seatOf.get(p.o.id);
    if (!seat) {
      seat = rooms.find((r) => r.id === p.room)?.seats.find((s) => !held.has(s.id))?.id;
      if (seat) held.add(seat);
    }
    return { id: p.o.id, room: p.room, ...(seat ? { seat } : {}), why: p.why, by: p.by };
  });
  return { homes, ...(note ? { note } : {}) };
}
