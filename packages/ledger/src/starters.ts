// The starter team: Odds most new owners want, offered on the first visit's
// Your team card. Each one the owner keeps there becomes a hire the Office
// Manager proposes at once, filled in, on the desk: the owner keeps its look
// in the hire window, as for any hire, and it starts at Draft. The words here
// are generic. A real person joins only as a New Altitude persona, never from
// this file (the 2026-11-12 rulings on personas and personal names).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { home } from './home.ts';
import { raiseAsk } from './office-asks.ts';
import type { HireProposal } from './schema.ts';

export type Starter = {
  id: string;
  /** What the card says it does, in one line. */
  says: string;
  /** Ticked on the card until the owner unticks it. */
  ticked: boolean;
  proposal: Omit<HireProposal, 'jobDescriptionFile'>;
  /** The job description the hire window reads. */
  desk: string;
};

/** The starters, in the order the card lists them. Adding one is one entry. */
export const STARTERS: readonly Starter[] = [
  {
    id: 'mail-clerk',
    says: 'Sorts your email, drafts replies and proposes filters. Nothing is sent without your yes.',
    ticked: true,
    proposal: {
      name: 'Penny',
      role: 'Mail Clerk',
      room: 'mail-room',
      permission: 'draft',
      remit: 'Keeps the inbox in order: sorts mail, drafts replies and proposes filters.',
      appearance: 'Neat, friendly, cardigan, reading glasses pushed up.',
      job: {
        name: 'Morning inbox',
        instructions:
          'Read the new mail since your last run. Draft a reply for each email that needs one with propose_reply, and propose a filter for any sender that fills the inbox with propose_filter. Report what you drafted and what can wait.',
        schedule: { every: 'weekday', at: '08:00' },
        report: true
      }
    },
    desk: `# Mail Clerk

You keep {owner}'s inbox in order.

1. Each morning, read what came in since your last run.
2. Draft a reply for each email that needs one, with propose_reply. Write as {owner} writes.
3. Propose a filter for a sender that fills the inbox, with propose_filter.
4. Tell {owner} what you drafted and what can wait, in a short report.

You never send anything. {owner} reviews each draft and sends it.
If you cannot reach the inbox, ask for Gmail with ask_for_access.
`
  }
];

/**
 * The manager proposes a hire for each starter the owner kept, at once and in
 * order. Each one's job description goes in the manager's folder, under
 * `starters/`, where the hire window reads it. An unknown id is skipped.
 */
export async function proposeStarters(managerId: string, ids: readonly string[]): Promise<number> {
  let raised = 0;
  for (const s of STARTERS) {
    if (!ids.includes(s.id)) continue;
    const file = `starters/${s.id}.md`;
    const path = home('staff', managerId, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, s.desk);
    await raiseAsk(managerId, {
      title: `Hire ${s.proposal.name}, your ${s.proposal.role}`,
      why: `You kept ${s.proposal.name} on your starter team. ${s.says}`,
      ifApproved: `The hire window opens filled in. Keep or change the look, then hire.`,
      hire: { ...s.proposal, jobDescriptionFile: file }
    });
    raised++;
  }
  return raised;
}
