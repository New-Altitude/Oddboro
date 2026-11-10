// Older proposals named a person in the role, for example "Nate B. Jones Persona".
// Match the whole identity, never a first name found somewhere in a job title.
export type PersonaHint = { role: string; personaSlug?: string };
const nameKey = (s: string) => s.toLowerCase().replaceAll('.', '').trim().replace(/\s+/g, ' ');
const roleName = (role: string) => /^(.+?)\s+persona$/i.exec(role.trim())?.[1];
export const hasPersonaHint = (p: PersonaHint) => !!(p.personaSlug || roleName(p.role));

export function matchPersona<T extends { slug: string; names: string[] }>(
  p: PersonaHint,
  entries: T[]
): T | undefined {
  if (p.personaSlug) return entries.find((e) => e.slug === p.personaSlug);
  const name = roleName(p.role);
  if (!name) return;
  const matches = entries.filter((e) =>
    [e.slug, ...e.names].some((n) => nameKey(n) === nameKey(name))
  );
  return matches.length === 1 ? matches[0] : undefined;
}
