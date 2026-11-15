// One set of bindings supplies the key handler, settings and shortcut hints.
export const HUD_KEYS = {
  open: { name: 'Open or close the HUD', key: 'Alt+H' },
  next: { name: 'Next decision', key: 'ArrowDown' },
  previous: { name: 'Previous decision', key: 'ArrowUp' },
  review: { name: 'Review selected decision', key: 'Enter' },
  back: { name: 'Back', key: 'Escape' }
} as const;
export type HudCommand = keyof typeof HUD_KEYS;
export type HudKeys = Record<HudCommand, string>;
export const commands = Object.keys(HUD_KEYS) as HudCommand[];
export const HUD_STORAGE = 'oddboro.hud.keys.v1';
export const defaultKeys = (): HudKeys => ({
  open: HUD_KEYS.open.key,
  next: HUD_KEYS.next.key,
  previous: HUD_KEYS.previous.key,
  review: HUD_KEYS.review.key,
  back: HUD_KEYS.back.key
});

export function chord(e: KeyboardEvent) {
  if (e.isComposing || ['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Unidentified'].includes(e.key))
    return '';
  // Option can change the character itself on a Mac. Keep the shortcut tied to its letter.
  const key =
    e.altKey && /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3)
      : e.key.length === 1
        ? e.key.toUpperCase()
        : e.key;
  return [
    e.ctrlKey && 'Control',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
    e.metaKey && 'Meta',
    key
  ]
    .filter(Boolean)
    .join('+');
}

export function bindingProblem(keys: HudKeys, command: HudCommand, value: string) {
  if (!value) return '';
  if (
    !/^(Control\+)?(Alt\+)?(Shift\+)?(Meta\+)?([A-Z0-9]|F([1-9]|1[0-2])|Arrow(Up|Down|Left|Right)|Enter|Escape|Home|End)$/.test(
      value
    )
  )
    return 'Choose a letter, number, function key, arrow, Home or End.';
  if (value === 'Escape' && command !== 'back') return 'Escape goes back.';
  if (value === 'Enter' && command !== 'review') return 'Enter opens the focused control.';
  if (command === 'open' && !/(Alt|Control|Meta)\+/.test(value) && !/^F\d+$/.test(value))
    return 'Include Alt, Control or Command for a Workspace shortcut.';
  if (['Alt+ArrowDown', 'Alt+ArrowUp'].includes(value))
    return 'Workspace uses this key to switch conversations.';
  const used = commands.find((k) => k !== command && keys[k] === value);
  return used ? 'Already used for ' + HUD_KEYS[used].name.toLowerCase() + '.' : '';
}

export function readKeys(raw: string | null): HudKeys {
  const defaults = defaultKeys();
  if (!raw) return defaults;
  try {
    const saved = JSON.parse(raw);
    const keys = { ...defaults };
    for (const id of commands) if (typeof saved[id] === 'string') keys[id] = saved[id];
    return commands.some((id) => bindingProblem(keys, id, keys[id])) ? defaults : keys;
  } catch {
    return defaults;
  }
}

export function keyLabel(key: string) {
  return (
    key
      .replace('ArrowDown', '↓')
      .replace('ArrowUp', '↑')
      .replace('ArrowLeft', '←')
      .replace('ArrowRight', '→')
      .replace('Control', 'Ctrl')
      .replace('Escape', 'Esc') || 'Off'
  );
}
