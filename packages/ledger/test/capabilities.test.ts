// Which grants accessOf holds back, how an Odd is told about each, what a run
// below the Odd's own level keeps and says (capped, accessInRun), and what
// my_access says of the Odd's tool, its own tools and its folders. That
// access() in apps/office skips a held-back grant is not tested yet (NEW-1617).
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  levelRoute,
  LEVELS,
  MODEL_SECTION,
  OFFICE_SECTION,
  officeSection,
  writesWait,
  type Level
} from '../src/access-words.ts';
import {
  accessInRun,
  accessOf,
  askAboveLevel,
  capped,
  levelLine,
  NETWORK_HELD_LINE,
  outsideLines,
  reachOf,
  type Capabilities
} from '../src/capabilities.ts';
import type { ConnectorRow, GrantRow } from '../src/office.ts';

/** A Claude Code Odd on a Mac with both switches off and no folder. */
const noOwnTools = {
  agent: 'claude',
  own: {
    commands: false,
    commandsHow: { state: 'switch' },
    web: false,
    network: false,
    granted: []
  }
} as const satisfies Pick<Capabilities, 'agent' | 'own'>;

function grant(
  level: Level,
  over: Partial<ConnectorRow> = {}
): GrantRow & { connector: ConnectorRow } {
  const connector = {
    id: 'notion',
    name: 'Notion',
    kind: 'http',
    readTools: ['search'],
    readyAt: new Date(),
    ...over
  } as ConnectorRow;
  return {
    staffId: 'odd',
    connectorId: connector.id,
    level,
    standing: [] as string[],
    askFirst: [] as string[],
    connector
  } as GrantRow & {
    connector: ConnectorRow;
  };
}

test('a grant loads only when it is connected and its level works: read anywhere, write from Draft', () => {
  for (const permission of LEVELS)
    for (const level of LEVELS)
      for (const ready of [true, false]) {
        const a = accessOf(grant(level, { readyAt: ready ? new Date() : null }), permission);
        const above = level !== 'read' && permission === 'read';
        const want = above ? 'above its level' : ready ? undefined : 'still connecting';
        assert.equal(a.heldBack, want, `${level} grant, ${permission} Odd, ready ${ready}`);
      }
});

test('a write grant reaches every tool and a read grant counts its read tools', () => {
  assert.equal(reachOf(accessOf(grant('act'), 'act')), 'every tool');
  assert.equal(reachOf(accessOf(grant('read'), 'read')), '1 tool');
  assert.equal(reachOf(accessOf(grant('read', { readTools: ['a', 'b'] }), 'read')), '2 tools');
});

test('each held-back reason tells the Odd what brings the tool back', () => {
  const caps = (a: ReturnType<typeof accessOf>): Capabilities => ({
    level: 'draft',
    remit: '',
    office: [],
    outside: [a],
    ...noOwnTools
  });
  const line = (a: ReturnType<typeof accessOf>) => outsideLines(caps(a), 'Sam')[0];
  const atRead = (a: ReturnType<typeof accessOf>) => ({ ...caps(a), level: 'read' as const });
  assert.equal(
    outsideLines(atRead(accessOf(grant('act'), 'read')), 'Sam')[0],
    'Notion (read and write): held back. It needs the Draft level or higher, and the current level is Read. It works again once Sam raises it. When a job needs a higher level, ask Sam for it with ask_for_level.'
  );
  // office_report reads it about a colleague, so the card is that Odd's.
  assert.equal(
    outsideLines(atRead(accessOf(grant('act'), 'read')), 'Sam', 'Rowan')[0],
    "Notion (read and write): held back. It needs the Draft level or higher, and the current level is Read. It works again once Sam raises it. Sam sets Rowan's level on Rowan's Settings tab, under Model."
  );
  // At Draft a write grant works, and each change waits for the owner's yes.
  assert.equal(
    line(accessOf(grant('act'), 'draft')),
    `Notion (read and write): every tool. Each call that changes something waits for Sam's yes: the office puts that exact call on their desk and makes it once they approve, then you carry on with what it returned. Call it once and move on; never call it again to retry, and never say it is done before you hear.`
  );
  assert.equal(
    outsideLines(caps(accessOf(grant('act'), 'draft')), 'Sam', 'Rowan')[0],
    "Notion (read and write): every tool. Each call Rowan makes that changes something waits for Sam's yes on their desk."
  );
  assert.equal(
    line(accessOf(grant('read', { readyAt: null }), 'draft')),
    'Notion (read only): held back until Sam finishes connecting it.'
  );
  assert.equal(
    line({ ...accessOf(grant('read'), 'draft'), heldBack: 'sign-in ran out' }),
    'Notion (read only): held back. Its sign-in ran out, and Sam needs to sign in again.'
  );
  assert.equal(line(accessOf(grant('read'), 'draft')), 'Notion (read only): 1 tool.');
});

test('the level route names whose level it is and the section of that card it is under', () => {
  const forms: [string, string][] = [
    ['your', 'Sam sets your level on your Settings tab, under Model.'],
    ["Rowan's", "Sam sets Rowan's level on Rowan's Settings tab, under Model."],
    ["that Odd's", "Sam sets that Odd's level on that Odd's Settings tab, under Model."]
  ];
  for (const [whose, said] of forms) assert.equal(levelRoute('Sam', whose), said, whose);
  // The section is the one the card's sub-tab shows (AccessTab reads MODEL_SECTION).
  assert.ok(levelRoute('Sam', 'your').endsWith(`, under ${MODEL_SECTION}.`));
});

test('the switches are placed on whose Settings tab, under the section the card shows them in', () => {
  const forms: [string, string][] = [
    ['your', 'your Settings tab, under Office'],
    ["Rowan's", "Rowan's Settings tab, under Office"],
    ["that Odd's", "that Odd's Settings tab, under Office"]
  ];
  for (const [whose, said] of forms) assert.equal(officeSection(whose), said, whose);
  // The section is the one the card's sub-tab shows (AccessTab reads OFFICE_SECTION).
  assert.ok(officeSection('your').endsWith(`, under ${OFFICE_SECTION}`));
});

test("ask_for_access's refusal above the level tells the Odd to ask for the level with ask_for_level, then ask again", () => {
  const said = askAboveLevel('read', 'write', 'Sam');
  assert.equal(
    said,
    'You hold read, so you cannot ask for write. When a job needs a higher level, ask Sam for it with ask_for_level. Once you have it, ask for write again.'
  );
});

test('only the Act level is told it may use a write tool without asking', () => {
  for (const level of LEVELS)
    assert.equal(levelLine(level, 'Sam').includes('without asking'), level === 'act', level);
});

test('a run capped at Draft reads as Draft, and a write grant it loads waits for the yes', () => {
  const own: Capabilities = {
    level: 'act',
    remit: '',
    office: [],
    outside: [accessOf(grant('act'), 'act'), accessOf(grant('read', { id: 'drive' }), 'act')],
    ...noOwnTools
  };
  const run = capped(own, 'draft');
  assert.equal(run.level, 'draft');
  assert.deepEqual(
    run.outside.map((a) => [a.connector.id, a.level, a.heldBack]),
    [
      ['notion', 'act', undefined],
      ['drive', 'read', undefined]
    ]
  );
  assert.equal(
    outsideLines(run, 'Sam')[0],
    `Notion (read and write): every tool. Each call that changes something waits for Sam's yes: the office puts that exact call on their desk and makes it once they approve, then you carry on with what it returned. Call it once and move on; never call it again to retry, and never say it is done before you hear.`
  );
  // Capped at Read, a write grant comes down to read.
  assert.equal(capped(own, 'read').outside[0].level, 'read');
  // The Odd's own access is unchanged: office_report reads it.
  assert.equal(own.level, 'act');
  assert.equal(own.outside[0].level, 'act');
});

test('a write grant works for a Draft Odd, capped or not, and waits for the yes; a Read Odd holds it back', () => {
  const own: Capabilities = {
    level: 'draft',
    remit: '',
    office: [],
    outside: [accessOf(grant('act'), 'draft')],
    ...noOwnTools
  };
  const [a] = capped(own, 'draft').outside;
  assert.equal(a.level, 'act');
  assert.equal(a.heldBack, undefined);
  assert.equal(writesWait(a.level, 'draft'), true);
  assert.equal(writesWait(a.level, 'act'), false);
  assert.equal(accessOf(grant('act'), 'read').heldBack, 'above its level');
});

test("my_access says a capped run's level and why, and an uncapped run's own level", () => {
  const own: Capabilities = {
    level: 'act',
    remit: '',
    office: [],
    outside: [accessOf(grant('act'), 'act')],
    ...noOwnTools
  };
  const draftOnly = accessInRun(own, 'Sam', { CEILING: 'draft' });
  assert.equal(
    draftOnly,
    [
      levelLine('draft', 'Sam'),
      "This run serves a colleague's hand-off or was started by the office, so it works at Draft at most, whatever Sam has approved.",
      'Your runs go through Claude Code.',
      'Your own tools work on files only. No shell: ask Sam to turn on Run commands with ask_for_switch. No web: ask Sam to turn on Browse the web with ask_for_switch.',
      'Sam grants other office tools in your Settings tab, under Office; when a job needs one, ask for it with ask_for_office_tool.',
      'Sam has given you no folders. When a job needs a folder outside the office, ask with ask_for_folder.',
      `- (id: notion) Notion (read and write): every tool. Each call that changes something waits for Sam's yes: the office puts that exact call on their desk and makes it once they approve, then you carry on with what it returned. Call it once and move on; never call it again to retry, and never say it is done before you hear.`
    ].join('\n')
  );
  assert.equal(
    accessInRun(own, 'Sam', {}),
    [
      levelLine('act', 'Sam'),
      'Your runs go through Claude Code.',
      'Your own tools work on files only. No shell: ask Sam to turn on Run commands with ask_for_switch. No web: ask Sam to turn on Browse the web with ask_for_switch.',
      'Sam grants other office tools in your Settings tab, under Office; when a job needs one, ask for it with ask_for_office_tool.',
      'Sam has given you no folders. When a job needs a folder outside the office, ask with ask_for_folder.',
      '- (id: notion) Notion (read and write): every tool.'
    ].join('\n')
  );
  assert.match(
    accessInRun(own, 'Sam', { SIGNED_OUT: 'notion' }),
    /Its sign-in ran out, and Sam needs to sign in again\./
  );
});

test('my_access says the tool, what its own tools reach and each folder, and a held network', () => {
  const own: Capabilities = {
    level: 'draft',
    remit: '',
    office: [],
    outside: [],
    agent: 'claude',
    own: {
      commands: true,
      commandsHow: { state: 'switch' },
      web: true,
      network: true,
      granted: [
        { path: '/Users/Shared/p', write: false },
        { path: '/Users/Shared/q', write: true }
      ]
    }
  };
  const shell = "a shell confined to your folders and Sam's developer tools (read only)";
  const said = (env: Record<string, string>) => accessInRun(own, 'Sam', env).split('\n');
  assert.deepEqual(said({}), [
    levelLine('draft', 'Sam'),
    'Your runs go through Claude Code.',
    `Your own tools work on files, plus ${shell}, which can reach the internet, and web search and fetch.`,
    'Sam grants other office tools in your Settings tab, under Office; when a job needs one, ask for it with ask_for_office_tool.',
    'Folders Sam gave you:',
    '- /Users/Shared/p (read only)',
    '- /Users/Shared/q (read and change)',
    'Sam has connected no outside tools for you yet.'
  ]);
  const held = said({ OFFICE_NETWORK_HELD: '1' });
  assert.equal(
    held[2],
    `Your own tools work on files, plus ${shell}, with no network, and web search and fetch.`
  );
  assert.equal(held[3], NETWORK_HELD_LINE);
  assert.equal(
    NETWORK_HELD_LINE,
    'This version of Claude Code refuses to let your commands reach the internet, so they have none.'
  );
  // A hold takes away only a network the run would have had, so nothing is said without one.
  const offline = { ...own, own: { ...own.own, web: false, network: false } };
  assert.ok(!accessInRun(offline, 'Sam', { OFFICE_NETWORK_HELD: '1' }).includes(NETWORK_HELD_LINE));
  // The refusal is Claude Code's, so a held office leaves another tool's Odd as it is.
  const codex = { ...own, agent: 'codex' as const };
  assert.equal(
    accessInRun(codex, 'Sam', { OFFICE_NETWORK_HELD: '1' }),
    accessInRun(codex, 'Sam', {})
  );
});
