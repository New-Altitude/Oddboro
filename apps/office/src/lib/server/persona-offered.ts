// The real people New Altitude last offered this owner as personas, kept from
// the office's own read of the list (`readListing` in persona.ts), so an Odd
// that can propose a hire knows who it may propose and proposes the real
// persona, never a look-alike. Nothing here calls New Altitude: a run reads
// what the last read kept. Only names and slugs, which New Altitude publishes.

/** The personas on offer at the last read that answered, or none when there is no list. */
let offered: { slug: string; displayName: string }[] = [];

/** The office read New Altitude's list: keep its names, or none when there is no list. */
export function heardOffers(list: { slug: string; displayName: string }[] | undefined): void {
  offered = (list ?? []).map(({ slug, displayName }) => ({ slug, displayName }));
}

/**
 * The prompt section for an Odd that can propose a hire: who New Altitude
 * offers, by name and slug, and who already works here. Empty with no list.
 * `here` are the slugs of persona Odds in the office.
 */
export function offeredSection(here: Set<string>): string {
  if (!offered.length) return '';
  const name = (o: { slug: string; displayName: string }) => `${o.displayName} (${o.slug})`;
  const open = offered.filter((o) => !here.has(o.slug));
  const hired = offered.filter((o) => here.has(o.slug)).map((o) => o.displayName);
  const line = [
    open.length
      ? `New Altitude offers {owner} these real people as personas, published with their consent: ${open.map(name).join(', ')}. When {owner} asks to hire one, call propose_hire with its persona_slug, and {owner} adds the real persona from the hire window. Never build a look-alike Odd of a real person.`
      : '',
    hired.length ? `Already working here as personas: ${hired.join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
  return `\n## New Altitude personas\n\n- ${line}\n`;
}
