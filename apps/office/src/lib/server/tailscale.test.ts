// The phone desk in Setup (tailscale.ts): what the office gives a Mac, Linux
// and Windows (hard rule 14), with a stand-in Tailscale, and the one click
// that lets the phone in. Run with `npm test -w @oddboro/office`.
import { folder, onPlatform, withEnv } from './office-under-test.ts';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Run } from './tailscale.ts';

// The office's own code loads after the harness has set its folders and port.
const { throughTailnet } = await import('./phone-door.ts');
const { allowPhoneDesk, phoneDesk, servesOffice } = await import('./tailscale.ts');

/** A folder with a stand-in `tailscale`, and `tailscale.exe` for Windows. */
const tools = join(folder, 'tailscale-bin');
mkdirSync(tools);
for (const name of ['tailscale', 'tailscale.exe']) {
  writeFileSync(join(tools, name), '#!/bin/sh\nexit 0\n');
  chmodSync(join(tools, name), 0o755);
}
const withTailscale = <T>(fn: () => T | Promise<T>) => withEnv({ PATH: tools }, fn);

const NAME = 'home-pc.tail1234.ts.net';
/** Tailscale as the stand-in answers: running, with this name, serving the office. */
const answers =
  (status: object, serve: object = {}): Run =>
  async (_command, args) =>
    JSON.stringify(args[0] === 'status' ? status : serve);
const running = { BackendState: 'Running', Self: { DNSName: `${NAME}.` } };
const served = {
  Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4502' } } } }
};

for (const [platform, sudo] of [
  ['darwin', ''],
  ['linux', 'sudo '],
  ['win32', '']
] as const) {
  test(`on ${platform}, Setup finds the name, whether it serves the office, and the command`, () =>
    onPlatform(platform, () =>
      withTailscale(async () => {
        const desk = await phoneDesk(answers(running, served));
        assert.deepEqual(desk, {
          tailscale: 'on',
          name: NAME,
          serving: true,
          serveCommand: `${sudo}tailscale serve --bg http://127.0.0.1:4502`,
          allowed: false,
          link: `https://${NAME}/desk`
        });
        // Not served yet: Setup shows the command instead.
        const unserved = await phoneDesk(answers(running, {}));
        assert.equal(unserved.tailscale === 'on' && unserved.serving, false);
      })
    ));

  test(`on ${platform}, no Tailscale, or one off or signed out, says so`, () =>
    onPlatform(platform, async () => {
      // The fixed install folders are not on this test machine.
      assert.deepEqual(await withEnv({ PATH: join(folder, 'nowhere') }, () => phoneDesk()), {
        tailscale: 'missing'
      });
      await withTailscale(async () => {
        assert.deepEqual(await phoneDesk(answers({ BackendState: 'NeedsLogin' })), {
          tailscale: 'off'
        });
        assert.deepEqual(await phoneDesk(answers({ BackendState: 'Stopped' })), {
          tailscale: 'off'
        });
        const fails: Run = async () => {
          throw new Error('not running');
        };
        assert.deepEqual(await phoneDesk(fails), { tailscale: 'off' });
      });
    }));
}

test('serve counts only when the name sends to this office', () => {
  for (const proxy of [
    'http://127.0.0.1:4502',
    'http://127.0.0.1:4502/',
    'http://localhost:4502',
    '4502'
  ])
    assert.equal(
      servesOffice({ Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: proxy } } } } }, NAME),
      true,
      proxy
    );
  for (const status of [
    {},
    { Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } },
    {
      Web: {
        [`other.tail1234.ts.net:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4502' } } }
      }
    },
    { Web: { [`${NAME}:443`]: { Handlers: { '/desk': { Proxy: 'http://127.0.0.1:4502' } } } } },
    // Straight at the office, which answers only this computer, so the phone gets nothing.
    { Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4500' } } } } }
  ])
    assert.equal(servesOffice(status, NAME), false, JSON.stringify(status));
});

/** The office's `.env`, fixed as the ledger loads (`ENV_FILE`): the harness's own. */
const { ENV_FILE: env, readEnv } = await import('@oddboro/ledger/env');

test('one click lists the name in .env and the door answers it at once', async () => {
  writeFileSync(env, 'ODDBORO_EXTRA_HOSTS=old-box.tail1234.ts.net\n');
  const asked = () => throughTailnet({ host: NAME, 'tailscale-user-login': 'owner@example.com' });
  await withEnv({ ODDBORO_EXTRA_HOSTS: '' }, () =>
    withTailscale(async () => {
      assert.equal(readEnv().ODDBORO_EXTRA_HOSTS, 'old-box.tail1234.ts.net');
      assert.equal(asked(), false);
      const r = await allowPhoneDesk(answers(running, served));
      assert.equal(r.desk.tailscale === 'on' && r.desk.allowed, true);
      assert.equal(asked(), true);
      // Clicked again, nothing changes.
      await allowPhoneDesk(answers(running, served));
    })
  );
  // The name joins what was there, and nothing else in the file changes.
  assert.equal(readFileSync(env, 'utf8'), `ODDBORO_EXTRA_HOSTS=old-box.tail1234.ts.net,${NAME}\n`);
});
