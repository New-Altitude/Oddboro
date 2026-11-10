import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MagpieState } from '../magpie.ts';
import { magpieSetup, type MagpieSetupInputs } from './magpie-setup.ts';

const state = (mode: 'existing' | 'managed' | null = null, ready = false): MagpieState => ({
  connected: mode !== null,
  mode,
  ready,
  version: '',
  managementUrl: mode ? 'http://127.0.0.1:3430' : '',
  gatewayUrl: '',
  shared: mode === 'existing',
  notice: '',
  problem: '',
  managedAvailable: true,
  providers: [],
  presets: [],
  models: [],
  groups: [],
  logins: [],
  calls: [],
  discoverySupported: false
});
function fixture(changes: Partial<MagpieSetupInputs> = {}) {
  const called = { attach: 0, discover: 0, start: 0, descriptor: 0 };
  const input: MagpieSetupInputs = {
    savedMode: null,
    invalidSaved: false,
    ownedRunning: false,
    state: async () => state(),
    appAccess: () => {
      called.descriptor++;
      return { status: 'absent' };
    },
    attach: async () => {
      called.attach++;
      return state('existing', true);
    },
    discover: async () => {
      called.discover++;
      return { candidates: [], gatewayOnly: false, uncertain: false };
    },
    available: () => true,
    start: async () => {
      called.start++;
      return state('managed', true);
    },
    ...changes
  };
  return { input, called };
}

test('one click starts built-in only when no configured or detected existing connection exists', async () => {
  const f = fixture();
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'connected');
  assert.equal(result.state.mode, 'managed');
  assert.deepEqual(f.called, { attach: 0, discover: 1, start: 1, descriptor: 1 });
});

test('working saved existing or owned connection is reused before any credential read or probe', async () => {
  for (const mode of ['existing', 'managed'] as const) {
    const f = fixture({ savedMode: mode, state: async () => state(mode, true) });
    const result = await magpieSetup(f.input);
    assert.equal(result.setup?.status, 'connected');
    assert.equal(result.setup?.reused, true);
    assert.deepEqual(f.called, { attach: 0, discover: 0, start: 0, descriptor: 0 });
  }
});

test('official app access can authorize automatically without disclosing its credential', async () => {
  const f = fixture({
    appAccess: () => ({
      status: 'available',
      managementUrl: 'http://127.0.0.1:45555',
      key: 'synthetic-private-web-key'
    })
  });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'connected');
  assert.equal(result.state.shared, true);
  assert.equal(f.called.attach, 1);
  assert.equal(f.called.start, 0);
  assert.equal(f.called.discover, 0);
  assert.equal(JSON.stringify(result).includes('synthetic-private-web-key'), false);
});

test('unavailable saved target never silently switches to another descriptor instance', async () => {
  const before = { ...state('existing'), problem: 'Unavailable' };
  const f = fixture({
    savedMode: 'existing',
    savedUrl: 'http://127.0.0.1:45555',
    state: async () => before,
    appAccess: () => ({
      status: 'available',
      managementUrl: 'http://127.0.0.1:46666',
      key: 'synthetic-private-web-key'
    })
  });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'authorization-required');
  assert.equal(result.candidates?.length, 2);
  assert.equal(f.called.attach, 0);
  assert.equal(f.called.start, 0);
});

test('invalid saved settings, a live unhealthy owned process, or missing bundle refuses implicit startup', async () => {
  for (const changes of [
    { invalidSaved: true },
    { savedMode: 'managed' as const, ownedRunning: true },
    { available: () => false }
  ]) {
    const f = fixture(changes);
    assert.equal((await magpieSetup(f.input)).setup?.status, 'unavailable');
    assert.equal(f.called.start, 0);
    assert.equal(f.called.attach, 0);
  }
});

test('stale saved existing connection, a web candidate and gateway-only instance require authorization', async () => {
  const detection = { candidates: [], gatewayOnly: false, uncertain: false };
  for (const changes of [
    {
      savedMode: 'existing' as const,
      savedUrl: 'http://127.0.0.1:3430',
      state: async () => ({ ...state('existing'), problem: 'Unavailable' })
    },
    {
      discover: async () => ({
        ...detection,
        candidates: [{ managementUrl: 'http://127.0.0.1:3430' }]
      })
    },
    { discover: async () => ({ ...detection, gatewayOnly: true }) }
  ]) {
    const f = fixture(changes);
    assert.equal((await magpieSetup(f.input)).setup?.status, 'authorization-required');
    assert.equal(f.called.start, 0);
    assert.equal(f.called.attach, 0);
  }
});

test('disabled, unsafe, stale or rejected app access never starts another runtime', async () => {
  for (const status of ['disabled', 'unsafe', 'rejected'] as const) {
    const f = fixture({
      appAccess: () =>
        status === 'rejected'
          ? {
              status: 'available',
              managementUrl: 'http://127.0.0.1:3430',
              key: 'synthetic-private-web-key'
            }
          : {
              status: 'authorization-required',
              reason: status === 'disabled' ? 'disabled' : 'unavailable'
            },
      attach: async () => {
        throw new Error('synthetic-private-web-key');
      }
    });
    const result = await magpieSetup(f.input);
    assert.equal(result.setup?.status, 'authorization-required');
    assert.equal(f.called.start, 0);
    assert.equal(JSON.stringify(result).includes('synthetic-private-web-key'), false);
  }
});

test('unknown listener is not absence, and authorized stopped gateway does not trigger private fallback', async () => {
  for (const changes of [
    { discover: async () => ({ candidates: [], gatewayOnly: false, uncertain: true }) },
    { savedMode: 'existing' as const, state: async () => state('existing') }
  ]) {
    const f = fixture(changes);
    assert.equal((await magpieSetup(f.input)).setup?.status, 'unavailable');
    assert.equal(f.called.start, 0);
  }
});

test('stopped owned preference restarts its selected runtime before reading unrelated descriptors', async () => {
  const f = fixture({
    savedMode: 'managed',
    state: async () => ({ ...state('managed'), problem: 'Stopped' })
  });
  assert.equal((await magpieSetup(f.input)).setup?.status, 'connected');
  assert.equal(f.called.start, 1);
  assert.equal(f.called.discover, 0);
  assert.equal(f.called.descriptor, 0);
});

test('a failed saved server connection never reads host credentials, probes local ports or starts a local runtime', async () => {
  const f = fixture({
    savedMode: 'existing',
    savedLocation: 'server',
    savedUrl: 'https://magpie.example.ts.net',
    state: async () => ({ ...state('existing'), location: 'server', problem: 'Server unavailable' })
  });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'authorization-required');
  assert.deepEqual(result.candidates, [{ managementUrl: 'https://magpie.example.ts.net' }]);
  assert.deepEqual(f.called, { attach: 0, discover: 0, start: 0, descriptor: 0 });
});

test('a fresh verified inference catalog takes precedence over management setup', async () => {
  const f = fixture({ gateway: async () => ({ ...state('existing', true), access: 'use' }) });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'connected');
  assert.equal(result.state.access, 'use');
  assert.deepEqual(f.called, { attach: 0, discover: 0, start: 0, descriptor: 0 });
});

test('keyless catalog refusal and no descriptor never fall through to another runtime', async () => {
  const f = fixture({
    gateway: async () => {
      throw new Error('private upstream error');
    }
  });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'authorization-required');
  assert.equal(JSON.stringify(result).includes('private upstream error'), false);
  assert.deepEqual(f.called, { attach: 0, discover: 0, start: 0, descriptor: 1 });
});

test('keyless gateway 401 still allows the supported official descriptor to authorize', async () => {
  const f = fixture({
    gateway: async () => {
      throw new Error('HTTP 401');
    },
    appAccess: () => ({
      status: 'available',
      managementUrl: 'http://127.0.0.1:3430',
      key: 'synthetic-private-web-key'
    })
  });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'connected');
  assert.equal(result.state.mode, 'existing');
  assert.equal(f.called.attach, 1);
  assert.equal(f.called.start, 0);
  assert.equal(f.called.discover, 0);
  assert.equal(JSON.stringify(result).includes('synthetic-private-web-key'), false);
});

test('failed gateway and rejected descriptor never imply consent to start a private runtime', async () => {
  let attempts = 0;
  const f = fixture({
    gateway: async () => {
      throw new Error('HTTP 401');
    },
    appAccess: () => ({
      status: 'available',
      managementUrl: 'http://127.0.0.1:3430',
      key: 'synthetic-private-web-key'
    }),
    attach: async () => {
      attempts++;
      throw new Error('private authorization failure');
    }
  });
  const result = await magpieSetup(f.input);
  assert.equal(result.setup?.status, 'authorization-required');
  assert.equal(attempts, 1);
  assert.equal(f.called.start, 0);
  assert.equal(f.called.discover, 0);
  assert.equal(JSON.stringify(result).includes('private authorization failure'), false);
});

test('saved admin and managed preferences are never silently downgraded to keyless discovery', async () => {
  for (const mode of ['existing', 'managed'] as const) {
    const f = fixture({
      savedMode: mode,
      state: async () => ({ ...state(mode), problem: 'Unavailable' }),
      gateway: async () => {
        assert.fail('A saved preference must not trigger unrelated gateway discovery.');
      }
    });
    const result = await magpieSetup(f.input);
    assert.equal(result.state.access === 'use', false);
  }
});

test('an unavailable saved use-only target stays selected without probing other listeners or management', async () => {
  const f = fixture({
    savedMode: 'existing',
    savedAccess: 'use',
    state: async () => ({ ...state('existing'), access: 'use', problem: 'Unavailable' }),
    gateway: async () => {
      assert.fail('A saved use-only endpoint must remain selected.');
    }
  });
  assert.equal((await magpieSetup(f.input)).setup?.status, 'unavailable');
  assert.deepEqual(f.called, { attach: 0, discover: 0, start: 0, descriptor: 0 });
});
