// What one Odd can do: its level, the office tools the owner gave it, and each
// outside tool it was granted, with whether a run gets that tool and why not.
// A run loads its tools from this, my_access shows it, office_report shows it
// for every Odd, and the owner's Access tab shows it, so all of them see the
// same thing. The one gap is a hosted sign-in that ran out: only the run's
// fresh token shows it. The run tells its own my_access (SIGNED_OUT), but
// office_report and the Access tab, read outside any run, cannot know.
import { grantsFor, type ConnectorRow, type GrantRow, type StaffRow } from './office.ts';
import { LEVELS, levelAtMost, type Level } from './schema.ts';
import { OFFICE_TOOLS } from './tools.ts';

/**
 * Why a run leaves out a tool the Odd was granted. A run adds
 * 'sign-in ran out' itself, since only a fresh token shows it.
 */
export type HeldBack = 'above its level' | 'still connecting' | 'sign-in ran out';

export type Access = {
  connector: ConnectorRow;
  level: Level;
  heldBack?: HeldBack;
};

export type Capabilities = {
  level: Level;
  remit: string;
  /** The office tools held beyond the ones every Odd has, by id. */
  office: string[];
  outside: Access[];
};

export async function capabilities(who: StaffRow): Promise<Capabilities> {
  return {
    level: who.permission,
    remit: who.remit,
    office: OFFICE_TOOLS.filter((t) => !t.always && who.tools.includes(t.id)).map((t) => t.id),
    outside: (await grantsFor(who.id)).map((g) => accessOf(g, who.permission))
  };
}

/** One grant as a run finds it: what it reaches, or why it is held back. */
export function accessOf(g: GrantRow & { connector: ConnectorRow }, permission: Level): Access {
  const heldBack: HeldBack | undefined = !levelAtMost(g.level, permission)
    ? 'above its level'
    : g.connector.readyAt
      ? undefined
      : 'still connecting';
  return { connector: g.connector, level: g.level, heldBack };
}

/**
 * What a run below the Odd's own level can do (a hand-off's, either side, or
 * a hub's pick-up): its level is `ceiling`, and a grant above it that the run
 * still loads comes down to read, since a grant is only read or act. A grant
 * already held back stays as it is. The run's tools, its prompt and its
 * my_access all read this, so they say the same.
 */
export function capped(caps: Capabilities, ceiling: Level): Capabilities {
  return {
    ...caps,
    level: ceiling,
    outside: caps.outside.map((a) =>
      a.heldBack || levelAtMost(a.level, ceiling) ? a : { ...a, level: 'read' }
    )
  };
}

/**
 * What my_access says in one run: the Odd's access as that run holds it. Only
 * the run knows two things, so the office passes them in its environment: its
 * ceiling (`CEILING`), set when it is below the Odd's own level, and the
 * sign-ins that ran out (`SIGNED_OUT`).
 */
export function accessInRun(
  own: Capabilities,
  owner: string,
  env: Record<string, string | undefined>
): string {
  const ceiling = LEVELS.find((l) => l === env.CEILING);
  const caps = ceiling ? capped(own, ceiling) : own;
  const signedOut = (env.SIGNED_OUT ?? '').split(',');
  const outside = caps.outside.map((a) =>
    !a.heldBack && signedOut.includes(a.connector.id)
      ? { ...a, heldBack: 'sign-in ran out' as const }
      : a
  );
  const lines = outsideLines({ ...caps, outside }, owner);
  return [
    levelLine(caps.level, owner),
    ...(ceiling
      ? [
          `This run was started by a colleague or by the office, not by ${owner}'s yes, so it works at ${LEVEL_NAME[ceiling]} at most.`
        ]
      : []),
    lines.length
      ? lines.map((l, i) => `- (id: ${outside[i].connector.id}) ${l}`).join('\n')
      : `${owner} has connected no outside tools for you yet.`
  ].join('\n');
}

/** How many tools a grant reaches, in words: every tool at write, else the read-only ones. */
export function reachOf(a: Access): string {
  const n = a.connector.readTools.length;
  return a.level === 'act' ? 'every tool' : `${n} ${n === 1 ? 'tool' : 'tools'}`;
}

/** One line per outside tool, in words that suit both the Odd and the Office Manager. */
export function outsideLines(c: Capabilities, owner: string): string[] {
  return c.outside.map((a) => {
    const what = `${a.connector.name} (${a.level === 'act' ? 'read and write' : 'read only'})`;
    switch (a.heldBack) {
      case 'above its level':
        return `${what}: held back. It needs the ${LEVEL_NAME[a.level]} level, and the current level is ${LEVEL_NAME[c.level]}. It works again once ${owner} raises the level.`;
      case 'still connecting':
        return `${what}: held back until ${owner} finishes connecting it.`;
      case 'sign-in ran out':
        return `${what}: held back. Its sign-in ran out, and ${owner} needs to sign in again.`;
      case undefined:
        return `${what}: ${reachOf(a)}.`;
    }
  });
}

const LEVEL_NAME = { read: 'Read', draft: 'Draft', act: 'Act' } as const;

/** The Odd's level, said to the Odd. */
export function levelLine(level: Level, owner: string): string {
  return {
    read: 'Your level is Read: you look and report. You change nothing outside the office.',
    draft: `Your level is Draft: you prepare things for ${owner}'s yes, drafts included. Nothing you make goes out until they say yes.`,
    act: `Your level is Act: you do housekeeping inside the office on your own, and use a tool ${owner} connected for you at read and write without asking each time.`
  }[level];
}
