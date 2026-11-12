// Oddboro's mark, the glowing pixel O, as a grid of colour roles.
// scripts/mark.ts draws the logo and the app icons from it, and the site's
// link preview (apps/site/scripts/share.ts) draws it on the grass.

/**
 * The letter in screen aqua (`l`) with a glow aqua edge (`h`), one ring of
 * teal deep glow (`d`) around it. `.` is the black it sits on, the middle of
 * the O too.
 */
export const MARK = [
  '..dddddd..',
  '.ddhhhhdd.',
  'ddhllllhdd',
  'dhlddddhhd',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhld..dhld',
  'dhlddddhld',
  'ddhhhhhldd',
  '.ddhllldd.',
  '..dddddd..'
];

/** Each role's colour, as its key in palette.json. */
export const MARK_COLOURS: Record<string, string> = { d: '6', l: 'G', h: 'g' };
