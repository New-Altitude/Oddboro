// Facts read for this manager run, from tool declarations and account state.
export function officeCapabilities(s: {
  tools: string[];
  account: string;
  offersState: string;
  offers: { slug: string; name: string }[];
  installed: { id: string; slug: string; quiet?: string }[];
}): string {
  return [
    '\n## Installed office capabilities',
    `Available office tools: ${s.tools.join(', ')}.`,
    `New Altitude account: ${s.account}. Persona offer list: ${s.offersState}.`,
    ...s.offers.slice(0, 30).map((o) => `Offered persona: ${o.slug} (${o.name}).`),
    ...(s.offers.length > 30
      ? [`${s.offers.length - 30} more offers are visible in the connection card.`]
      : []),
    ...s.installed.map(
      (o) =>
        `Installed persona: ${o.slug}, Odd ${o.id}, ${o.quiet ? `waiting: ${o.quiet}` : 'connected'}.`
    ),
    'Use request_persona to put account sign-in and offered persona choices in this conversation. Keep the original goal and continuation. Never infer a package from an ordinary Odd name or search private settings for service addresses.',
    'Only the owner maps an ordinary Odd to an offered persona. Its ID, chat and files stay; its previous instructions are retained and access must be granted again. An absent offer is unavailable, not connected.',
    'For an existing outside-tool sign-in failure, use ask_for_access and its existing reconnect task. A prose checklist cannot prove a connection. The owner can review and withdraw a superseded checklist on the connection card.',
    ''
  ].join('\n');
}

/** The same declaration conditions the tool server uses, read for this run. */
export async function currentOfficeCapabilities(
  who: import('@oddboro/ledger').StaffRow,
  chat: boolean
) {
  const { grantsFor, projectConnections } = await import('@oddboro/ledger');
  const { isOffered, OFFICE_TOOLS } = await import('@oddboro/ledger/tools');
  const { personaCapabilityState } = await import('./persona.ts');
  const [grants, projects, state] = await Promise.all([
    grantsFor(who.id),
    projectConnections(who.id),
    personaCapabilityState()
  ]);
  const run = {
    chat,
    manager: true,
    gmail: grants.some((g) => g.connector.config.google === 'gmail'),
    project: projects.length > 0
  };
  return officeCapabilities({
    ...state,
    tools: OFFICE_TOOLS.filter((t) => isOffered(who.tools, t.id, run)).map((t) => t.id)
  });
}
