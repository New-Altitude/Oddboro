import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'oddboro-gateway-run-'));
process.env.ODDBORO_HOME = home;
const { cleanEnv, officeDrawsLooks } = await import('./claude.ts');
const { LAUNCHES } = await import('./cli.ts');
const { modelChoice } = await import('./staff.ts');
const { drawLook } = await import('./looks.ts');
const { drawOffice } = await import('./office-design.ts');

test('direct runs strip inherited gateway settings', () => {
  process.env.ANTHROPIC_BASE_URL = 'http://inherited';
  process.env.ANTHROPIC_AUTH_TOKEN = 'inherited';
  process.env.MAGPIE_API_KEY = 'inherited';
  const env = cleanEnv();
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.MAGPIE_API_KEY, undefined);
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.MAGPIE_API_KEY;
});

test('Codex gateway launch works without a vendor login and keeps the key out of shell config', async () => {
  const launch = await LAUNCHES.codex({
    key: 'gateway',
    staffId: 'one',
    dir: home,
    reads: [],
    writes: [],
    granted: [],
    web: false,
    commands: true,
    network: false,
    system: 'system',
    input: 'hello',
    servers: {},
    allowed: [],
    timeoutMs: 1000,
    account: 'office',
    model: 'group/example',
    connection: { baseUrl: 'http://127.0.0.1:1234', apiKey: 'test-key', model: 'group/example' }
  });
  const second = await LAUNCHES.codex({
    key: 'gateway-two',
    staffId: 'two',
    dir: home,
    reads: [],
    writes: [],
    granted: [],
    web: false,
    commands: true,
    network: false,
    system: 'system',
    input: 'hello',
    servers: {},
    allowed: [],
    timeoutMs: 1000,
    account: 'other',
    model: 'group/example',
    connection: { baseUrl: 'http://127.0.0.1:1234', apiKey: 'test-key', model: 'group/example' }
  });
  assert.ok(!('refused' in second));
  const direct = await LAUNCHES.codex({
    key: 'direct',
    staffId: 'one',
    dir: home,
    reads: [],
    writes: [],
    granted: [],
    web: false,
    commands: true,
    network: false,
    system: 'system',
    input: 'hello',
    servers: {},
    allowed: [],
    timeoutMs: 1000,
    account: 'office'
  });
  assert.ok('refused' in direct);
  assert.ok(!('refused' in launch));
  if ('refused' in launch) return;
  try {
    assert.equal(launch.env.MAGPIE_API_KEY, 'test-key');
    if (!('refused' in second)) {
      assert.notEqual(launch.env.CODEX_HOME, second.env.CODEX_HOME);
      assert.notEqual(launch.env.TMPDIR, second.env.TMPDIR);
      second.done();
    }
    assert.ok(launch.args.includes('group/example'));
    assert.ok(launch.args.some((arg) => arg.includes('http://127.0.0.1:1234/v1')));
    assert.ok(!launch.args.some((arg) => arg.includes('test-key')));
    assert.ok(launch.args.includes('shell_environment_policy.inherit="core"'));
    assert.ok(
      !launch.args
        .find((arg) => arg.startsWith('shell_environment_policy.set='))
        ?.includes('MAGPIE_API_KEY')
    );
  } finally {
    launch.done();
  }
});

test('staff picks its own model or the office gateway without silently falling back', () => {
  process.env.OFFICE_AGENT = 'claude';
  process.env.OFFICE_MAGPIE_MODEL = 'group/default';
  assert.equal(
    modelChoice({ agent: 'claude', model: 'magpie:group/chosen' }),
    'magpie:group/chosen'
  );
  assert.equal(modelChoice({ agent: 'claude', model: null }), 'magpie:group/default');
  assert.equal(modelChoice({ agent: 'claude', model: 'claude-fable-5-1' }), 'claude-fable-5-1');
  assert.equal(modelChoice({ agent: 'claude', model: 'magpie:invalid' }), 'magpie:invalid');
  assert.equal(modelChoice({ agent: 'codex', model: null }), undefined);
  delete process.env.OFFICE_MAGPIE_MODEL;
  delete process.env.OFFICE_AGENT;
});

test('unqualified gateway models use the build-from-parts path', async () => {
  process.env.OFFICE_MAGPIE_MODEL = 'group/opus';
  assert.equal(officeDrawsLooks(), false);
  await assert.rejects(
    drawLook({ name: 'Test', role: 'Test', description: '', model: 'opus' }),
    /Build this look from parts/
  );
  await assert.rejects(drawOffice({ description: 'Test' }), /ready-made Main Street/);
  delete process.env.OFFICE_MAGPIE_MODEL;
  rmSync(home, { recursive: true, force: true });
});
