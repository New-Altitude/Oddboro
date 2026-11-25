// The ⌘K finder's rules, apart from the page so they test without a browser.
// `OddFinder.svelte` draws it.

export type Findable = { id: string; name: string; role: string };

/**
 * The Odds whose name or role holds what the owner typed. Names that start
 * with it come first, then names that hold it, then roles, each in roster order.
 */
export function findOdds<T extends Findable>(odds: readonly T[], typed: string): T[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [...odds];
  const rank = (p: T) => {
    const name = p.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return p.role.toLowerCase().includes(q) ? 2 : -1;
  };
  return odds
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
}

/** What a key does in the finder: move to another row, open one, or nothing. */
export type FinderStep = { to: number } | { pick: number } | undefined;

/** Up and Down move, wrapping at the ends; Home and End jump; Enter opens the row on. */
export function finderKey(key: string, at: number, count: number): FinderStep {
  if (!count) return undefined;
  const on = Math.min(Math.max(at, 0), count - 1);
  switch (key) {
    case 'ArrowDown':
      return { to: (on + 1) % count };
    case 'ArrowUp':
      return { to: (on - 1 + count) % count };
    case 'Home':
      return { to: 0 };
    case 'End':
      return { to: count - 1 };
    case 'Enter':
      return { pick: on };
    default:
      return undefined;
  }
}
