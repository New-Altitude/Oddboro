// The phone app: the owner's office on a phone on their tailnet
// (docs/remote-desk.md). It loads what its tabs show first: the owner's name,
// the Odds, the desk, Home's next jobs and goals moving today, the goals, and
// each Odd's last chat line for Messages.
import { desk, guessesWaiting, ownerName, roster, zone } from '@oddboro/ledger';
import { phoneHome } from '#lib/server/phone-home.ts';
import { phoneGoals } from '#lib/server/phone-goals.ts';
import { lastLines } from '#lib/server/phone-messages.ts';
import { toProfile } from '#lib/server/profile.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const staff = await roster();
  const [guesses, owner, onDesk, home, goals, messages] = await Promise.all([
    guessesWaiting(staff.map((s) => s.id)),
    ownerName(),
    desk(),
    phoneHome(),
    phoneGoals(),
    lastLines()
  ]);
  return {
    office: owner === 'the owner' ? 'Your office' : `${owner}'s Office`,
    staff: staff.map((s) => toProfile(s, guesses[s.id])),
    desk: onDesk,
    home,
    goals,
    messages,
    zone: zone()
  };
};
