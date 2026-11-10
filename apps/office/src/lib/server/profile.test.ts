// What the page gets of an Odd (`toProfile`), in an office under test
// (office-under-test.ts), whose ledger takes the line a held network records.
// Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { StaffRow } from '@oddboro/ledger';
import { setZone } from '@oddboro/ledger/time';
import { onPlatform, ownerHome } from './office-under-test.ts';

// After the office under test set its home, as the office's own imports are.
const { toProfile } = await import('./profile.ts');
const { holdNetwork, resetHeldNetwork } = await import('@oddboro/ledger');

/** A staff row as the ledger returns it; anything not named is off or empty. */
const row = (o: Partial<StaffRow> = {}): StaffRow => ({
  id: 'penny',
  name: 'Penny',
  role: 'Writer',
  office: 'Main Street',
  sprite: 'staff',
  variant: 'a',
  portrait: 'a',
  room: 'workspace',
  permission: 'draft',
  agent: 'claude',
  account: null,
  model: null,
  effort: null,
  tools: [],
  commands: false,
  web: false,
  folders: [],
  remit: 'Writes the newsletter.',
  desk: 'You are Penny.',
  look: null,
  portraitPx: null,
  package: null,
  hiredAt: new Date('2026-11-04T01:30:00Z'),
  leftAt: null,
  ...o
});

test("an Odd hired on an evening in New York shows that day as its hire date, not tomorrow's UTC date", () => {
  setZone('America/New_York');
  // 8:30 PM in New York on Nov 3 is 01:30 UTC on Nov 4.
  assert.equal(toProfile(row()).hired, '2026-11-03');
});

test("the page's profile carries what runs reach, each folder's ~ form, the offer and the web line", async () => {
  await onPlatform('darwin', async () => {
    const grok = toProfile(row({ agent: 'grok', commands: true, web: true }));
    assert.equal(grok.commands, true, 'the stored switch stays as the owner set it');
    assert.equal(grok.reach.commands, false);
    const how = grok.reach.commandsHow;
    assert.equal(how.state === 'never' && how.offer, 'claude');
    assert.equal(grok.webLine, 'Search and read web pages.');

    const both = row({ commands: true, web: true });
    const claude = toProfile(both);
    assert.deepEqual(
      { commands: claude.reach.commands, network: claude.reach.network, held: claude.reach.held },
      { commands: true, network: true, held: false }
    );
    assert.equal(
      claude.webLine,
      'Search and read web pages. With Run commands on, its commands can reach the internet too.'
    );
    const codex = row({ agent: 'codex', web: true });
    assert.equal(
      toProfile(codex).webLine,
      "Search the web. Codex's commands stay off the internet."
    );

    await ownerHome(async (home) => {
      const garden = join(home, 'garden');
      mkdirSync(garden);
      const gone = join(home, 'gone');
      const p = toProfile(
        row({
          folders: [
            { path: garden, write: true },
            { path: gone, write: false }
          ]
        })
      );
      // As stored, so the owner can still take back the one gone from the disk.
      assert.deepEqual(p.folders, [
        { path: garden, write: true, shown: '~/garden' },
        { path: gone, write: false, shown: '~/gone' }
      ]);
      assert.deepEqual(p.reach.granted, [{ path: garden, write: true }]);
    });

    // Held: this office met a Claude Code that refused the open network.
    await holdNetwork();
    try {
      const held = toProfile(both);
      assert.deepEqual(
        { network: held.reach.network, held: held.reach.held },
        { network: false, held: true }
      );
      assert.equal(
        held.webLine,
        'Search and read web pages. This version of Claude Code keeps its commands off the internet.'
      );
      // The refusal is Claude Code's, so a Codex Odd is not held, and keeps its own line.
      const codexHeld = toProfile(codex);
      assert.deepEqual(
        { network: codexHeld.reach.network, held: codexHeld.reach.held },
        { network: false, held: false }
      );
      assert.equal(codexHeld.webLine, "Search the web. Codex's commands stay off the internet.");
    } finally {
      resetHeldNetwork();
    }
  });
});

test('a profile shows the office gateway only on the office tool', () => {
  const beforeAgent = process.env.OFFICE_AGENT;
  const beforeModel = process.env.OFFICE_MAGPIE_MODEL;
  try {
    process.env.OFFICE_AGENT = 'claude';
    process.env.OFFICE_MAGPIE_MODEL = 'group/route';
    assert.equal(toProfile(row()).officeModel, 'magpie:group/route');
    assert.notEqual(toProfile(row({ agent: 'codex' })).officeModel, 'magpie:group/route');
    assert.equal(toProfile(row({ model: 'magpie:provider/model' })).model, 'magpie:provider/model');
  } finally {
    if (beforeAgent === undefined) delete process.env.OFFICE_AGENT;
    else process.env.OFFICE_AGENT = beforeAgent;
    if (beforeModel === undefined) delete process.env.OFFICE_MAGPIE_MODEL;
    else process.env.OFFICE_MAGPIE_MODEL = beforeModel;
  }
});
