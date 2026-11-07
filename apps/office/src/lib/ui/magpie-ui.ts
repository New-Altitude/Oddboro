import type { Agent } from '@oddboro/ledger/agents';
import type { MagpieState } from '../magpie.ts';

/** Auth pages may leave this computer, but never use a script or credential-bearing URL. */
export function magpieSignInUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return;
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      return;
    return url.href;
  } catch {
    return;
  }
}

export const magpieModels = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  )
];

/** Show only routes Magpie says are ready. Keep a saved missing route visible in the picker. */
export function magpieChoices(state: MagpieState | undefined) {
  if (!state?.connected) return [];
  const ready = new Set(state.providers.filter((p) => p.ready && !p.off).map((p) => p.id));
  // The authenticated management view can qualify individual providers. A
  // use-only gateway exposes only its published catalog, including group aliases.
  const models =
    state.access === 'use'
      ? state.ready
        ? state.models
        : []
      : state.models.filter((m) => ready.has(m.provider));
  return [
    ...models.map((m) => ({
      id: `magpie:${m.id}`,
      name:
        m.kind === 'group'
          ? `${m.name} (routing alias)`
          : m.provider
            ? `${m.name} (${m.provider})`
            : m.name,
      group: m.kind === 'group'
    })),
    ...(state.access === 'use' ? [] : state.groups)
      .filter((g) => g.ready)
      .map((g) => ({
        id: `magpie:${g.ref}`,
        name: `${g.name} (routing group)`,
        group: true
      }))
  ];
}

/** A finished sign-in must not keep the next sign-in disabled. */
export function magpieSignInActive(state: string | undefined): boolean {
  return (
    !!state && !['done', 'error', 'canceled', 'cancelled', 'complete', 'failed'].includes(state)
  );
}

/** New Magpie setups use bundled Pi; an explicit compatible runner remains the owner's choice. */
export function magpieRunner(
  current: Agent,
  tools: { id: Agent; installed: boolean }[],
  configured = false
): Agent | undefined {
  if (
    configured &&
    ['pi', 'claude', 'codex'].includes(current) &&
    tools.some((tool) => tool.id === current)
  )
    return current;
  return tools.find((tool) => tool.id === 'pi')?.id;
}

/** Selecting the gateway before its first route must never inherit direct-login readiness. */
export function officeAiReady(input: {
  throughMagpie: boolean;
  installed: boolean;
  tooOld: boolean;
  gatewayReady: boolean;
  directReady: boolean;
}): boolean {
  return (
    input.installed &&
    !input.tooOld &&
    (input.throughMagpie ? input.gatewayReady : input.directReady)
  );
}
