// The first visit's cards, in order, and each card's title. Error reports and
// the New Altitude sign-in are not among them: the owner finds both in Setup,
// so a new owner reaches a working office sooner.
export const STEPS = ['mac', 'you', 'ai', 'manager', 'space', 'go'] as const;
export type Step = (typeof STEPS)[number];
export const TITLE: Record<Step, string> = {
  mac: 'Your computer',
  you: 'You',
  ai: 'Your AI',
  manager: 'Your office manager',
  space: 'Your space',
  go: 'Open the office'
};
