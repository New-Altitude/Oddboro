/** A strip click selects an existing pane without reloading or discarding its drafts. */
export type OfficeLink = { odd: string } | { desk: true };
export function officeLink(value: unknown): OfficeLink | undefined {
  if (!value || typeof value !== 'object') return;
  if ('desk' in value && value.desk === true) return { desk: true };
  if ('odd' in value && typeof value.odd === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value.odd))
    return { odd: value.odd };
}
export const FLOOR_CHANNEL = 'oddboro.floor-activity';
