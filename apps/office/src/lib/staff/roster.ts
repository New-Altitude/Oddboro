// The shape of a staffer on the floor, and the words for what each one is
// doing. The staff themselves live in Postgres; hiring adds a row there.
import type { Agent, PersonaLink, StaffRow } from '@oddboro/ledger';
import type { LookSpec } from '@oddboro/sprites/look';
import { officeDay } from '@oddboro/ledger/time';

export type Activity =
  'work' | 'intake' | 'read' | 'wait' | 'play' | 'rest' | 'eat' | 'exercise' | 'talk' | 'home';

export type PermissionLevel = 'read' | 'draft' | 'act';

/** The most characters an Odd's name, role and remit take, however it joins: hired or added from New Altitude. */
export const LIMITS = { name: 40, role: 60, remit: 200 } as const;

export type StaffProfile = {
  id: string;
  name: string;
  role: string;
  office: string;
  sprite: string;
  variant: string;
  portrait: string;
  hired: string;
  permission: PermissionLevel;
  /** The coding tool its runs go through. */
  agent: Agent;
  /** The office tools the owner granted, beyond the ones every staffer has. */
  tools: string[];
  /** One sentence on what this staffer is for, shown on the card. */
  remit: string;
  /** The room template this staffer works in when it has a choice. */
  room: string;
  /** Guesses waiting for the owner's Keep on its Lessons tab. */
  guesses: number;
  /** A generated look: where its frames and portrait load from. Absent for hand-drawn art. */
  look?: { spec: LookSpec; sheet: string; portrait: string; version: string };
  /** Set for an Odd added from a New Altitude persona's package. */
  persona?: PersonaLink;
};

/** A short stamp that changes whenever the look or portrait does. */
export function lookVersion(look: LookSpec, portraitPx: string): string {
  let h = 5381;
  for (const ch of JSON.stringify(look) + portraitPx) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/**
 * A staff row as the page needs it. The job description stays on the server.
 * A new hire has no guesses of its own; the next office load counts any for every Odd.
 */
export function toProfile(r: StaffRow, guesses = 0): StaffProfile {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    office: r.office,
    sprite: r.sprite,
    variant: r.variant,
    portrait: r.portrait,
    hired: officeDay(new Date(r.hiredAt)),
    permission: r.permission,
    agent: r.agent,
    tools: r.tools,
    remit: r.remit,
    room: r.room,
    guesses,
    look:
      r.look && r.portraitPx
        ? {
            spec: r.look,
            version: lookVersion(r.look, r.portraitPx),
            sheet: `/api/staff/${r.id}/look?v=${lookVersion(r.look, r.portraitPx)}`,
            portrait: `/api/staff/${r.id}/portrait?v=${lookVersion(r.look, r.portraitPx)}`
          }
        : undefined,
    ...(r.package ? { persona: r.package } : {})
  };
}

/** What a person reads on the floor for each activity. */
export const ACTIVITY_LABEL: Record<Activity, string> = {
  work: 'Working',
  intake: 'Sorting the mail',
  read: 'Reading in the library',
  wait: 'Waiting on you',
  play: 'In the break room',
  rest: 'Taking a break',
  eat: 'At lunch',
  exercise: 'In the gym',
  talk: 'Talking with you',
  home: 'Gone home'
};
