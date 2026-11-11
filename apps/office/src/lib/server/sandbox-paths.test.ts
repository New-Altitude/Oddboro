// Each system a tool sandboxes on has paths declared for it, and those paths
// are the values the office passes there. Run with `npm test -w @oddboro/office`.
import { onPlatform } from './office-under-test.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Agent } from '@oddboro/ledger';
import type { SandboxPaths } from './sandbox-paths.ts';

const { AGENT_PLATFORMS, AGENTS } = await import('@oddboro/ledger');
const { SANDBOX_PATHS, sandboxPaths } = await import('./sandbox-paths.ts');

/**
 * Where each tool's walls name the system's own paths: Claude Code's sandbox
 * and Codex's kernel profile only where they run commands (on Windows Codex
 * takes read-only mode, which names none), Grok's deny rules wherever it runs.
 * Gemini's walls are its policy file and its include list, which name no
 * system path.
 */
const SANDBOXES_ON: Record<Agent, () => readonly NodeJS.Platform[]> = {
  claude: () => AGENT_PLATFORMS.claude.commands,
  grok: () => AGENT_PLATFORMS.grok.runs,
  codex: () => AGENT_PLATFORMS.codex.commands,
  gemini: () => []
};

test('every system a tool sandboxes on has its sandbox paths declared', () => {
  const missing = AGENTS.flatMap((agent) =>
    SANDBOXES_ON[agent]()
      .filter((platform) => !SANDBOX_PATHS[platform])
      .map((platform) => `${agent} on ${platform}`)
  );
  assert.deepEqual(missing, []);
});

/**
 * What the office passed to Grok and Codex on Linux and Windows before these
 * paths had a home. Spelt out here, since a change to one of them changes what
 * a shipped office runs with and has to show in review.
 */
const PASSED: SandboxPaths = {
  tmpRoot: '/private/tmp',
  denyReadRoots: ['/Users', '/Volumes', '/private/tmp', '/tmp', '/private/var/folders'],
  strictReads: [
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/dev',
    '/System',
    '/Library',
    '/private',
    '/tmp',
    '/var'
  ],
  grokShut: ['/Library', '/tmp', '/var'],
  codexReads: ['/Library/Developer/CommandLineTools', '/private/var/db/xcode_select_link'],
  opensslConf: '/System/Library/OpenSSL/openssl.cnf'
};

/** Where a system passes other than the Mac's values, measured there. */
const MEASURED: Partial<Record<NodeJS.Platform, Partial<SandboxPaths>>> = {
  linux: { grokShut: ['/Library'] }
};

for (const platform of ['linux', 'win32'] as const)
  for (const key of Object.keys(PASSED) as (keyof SandboxPaths)[])
    test(`${key} on ${platform} is the value the office already passes there`, async () => {
      const paths = await onPlatform(platform, sandboxPaths);
      assert.deepEqual(paths[key], MEASURED[platform]?.[key] ?? PASSED[key]);
    });

test('a system with no sandbox paths declared stops the run, and gets nothing else', async () => {
  await assert.rejects(
    onPlatform('freebsd', sandboxPaths),
    /No sandbox paths are declared for freebsd/
  );
});
