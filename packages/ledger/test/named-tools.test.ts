// That a tool's description, and each of its arguments' descriptions, names
// only office tools the Odd reading it holds, for an Odd holding no office
// tool the owner gives and for one holding each alone, in a run and in a chat,
// since a chat offers tools no other run does (`inChat`). The tool server runs
// in its own process, as for a run (tool-server.ts). Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, toolServer } from './tool-server.ts';

const { staff } = await import('../src/schema.ts');
const { GRANTABLE_TOOLS, OFFICE_TOOLS } = await import('../src/tools.ts');

/**
 * Office tools a tool's description names though the Odd reading it may not
 * hold them, by the tool that names them. Each is owed to NEW-1716: fixing
 * one changes what an Odd reads, so it is that row's work.
 */
const NAMES_UNHELD: Record<string, readonly string[]> = {
  raise_ask: ['ask_for_access', 'propose_hire'], // NEW-1716
  give_owner_a_task: ['ask_for_access'], // NEW-1716
  find_connectors: ['ask_for_access'], // NEW-1716
  ask_for_access: ['find_connectors'], // NEW-1716
  reconnect_access: ['give_owner_a_task'], // NEW-1716
  propose_hire: ['propose_goal_plan'], // NEW-1716
  propose_goal_plan: ['office_report', 'hand_off'] // NEW-1716, in its arguments' descriptions
};

/** Each Odd and the office tools it holds beyond the ones every Odd has. */
const ODDS: [id: string, holds: string[]][] = [
  ['holds-none', []],
  ...GRANTABLE_TOOLS.map((t): [string, string[]] => [`holds-${t.replaceAll('_', '-')}`, [t]])
];
await db.insert(staff).values(
  ODDS.map(([id, tools]) => ({
    id,
    name: id,
    role: 'Tester',
    remit: 'Tests.',
    variant: 'a',
    portrait: 'a',
    permission: 'draft' as const,
    desk: `You are ${id}.`,
    tools
  }))
);

/** The office tools `text` names, by id as a whole word. */
const named = (text: string): string[] =>
  OFFICE_TOOLS.map((t) => t.id).filter((id) => new RegExp(`\\b${id}\\b`).test(text));

/**
 * Every description in a tool's input schema, at any depth, but an
 * `office_tools` argument's: a hire's, which lists the office tools a hire may be given, as values to
 * pick from, not tools for the reader to call.
 */
const descriptions = (schema: unknown): string[] =>
  Array.isArray(schema)
    ? schema.flatMap(descriptions)
    : schema && typeof schema === 'object'
      ? Object.entries(schema).flatMap(([key, v]) =>
          key === 'office_tools'
            ? []
            : key === 'description' && typeof v === 'string'
              ? [v]
              : descriptions(v)
        )
      : [];

/** The kinds of run whose tool lists differ by what the Odd holds: a chat carries the owner's words. */
const RUNS = { run: {}, chat: { OWNER_SAID: 'Please sort this out.' } };

/** Each tool the Odd's server lists in `run`, with the office tools it names that the Odd does not hold. */
async function unheld(id: string, run: keyof typeof RUNS): Promise<Record<string, string[]>> {
  const server = await toolServer(id, { RUN_KEY: `k-${id}-${run}`, ...RUNS[run] });
  const { tools } = await server.listTools();
  const held = new Set(tools.map((t) => t.name));
  const reply = (await server.callTool({ name: 'my_access', arguments: {} })) as {
    content: { text: string }[];
  };
  return {
    ...Object.fromEntries(
      tools.map((t) => [
        t.name,
        named([t.description ?? '', ...descriptions(t.inputSchema)].join('\n')).filter(
          (n) => !held.has(n)
        )
      ])
    ),
    // my_access says how an Odd gets what it lacks, so its answer is held the same way.
    'my_access answer': named(reply.content[0].text).filter((n) => !held.has(n))
  };
}

const seen: Record<string, Set<string>> = {};
for (const [id, holds] of ODDS)
  // A cast only to name the keys: Object.keys types them as strings.
  for (const run of Object.keys(RUNS) as (keyof typeof RUNS)[])
    test(`a tool description names only office tools the Odd holds, except the declared ones (holding ${holds.join(', ') || 'none'}, in a ${run})`, async () => {
      const undeclared: Record<string, string[]> = {};
      for (const [tool, names] of Object.entries(await unheld(id, run))) {
        for (const n of names) (seen[tool] ??= new Set()).add(n);
        const left = names.filter((n) => !NAMES_UNHELD[tool]?.includes(n));
        if (left.length) undeclared[tool] = left;
      }
      assert.deepEqual(undeclared, {}, `tools named that ${id} does not hold in a ${run}`);
    });

test('every declared name is still named by its tool for some Odd', () => {
  for (const [tool, names] of Object.entries(NAMES_UNHELD))
    for (const n of names) assert.ok(seen[tool]?.has(n), `${tool} no longer names ${n}`);
});
