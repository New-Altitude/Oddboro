import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MagpieState } from '../magpie.ts';
import {
  magpieChoices,
  magpieModels,
  magpieSignInUrl,
  magpieSignInActive,
  magpieRunner,
  officeAiReady
} from './magpie-ui.ts';

test('sign-in links allow secure provider pages and local callbacks, refusing scripts and embedded credentials', () => {
  assert.equal(
    magpieSignInUrl('https://example.com/authorize?state=one'),
    'https://example.com/authorize?state=one'
  );
  assert.equal(magpieSignInUrl('http://127.0.0.1:1234/callback'), 'http://127.0.0.1:1234/callback');
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://secret@example.com',
    'http://example.com',
    'not a URL'
  ])
    assert.equal(magpieSignInUrl(url), undefined);
});

test('model names are trimmed and deduplicated without changing provider-qualified references', () => {
  assert.deepEqual(magpieModels(' provider/model, other/model\nprovider/model\n '), [
    'provider/model',
    'other/model'
  ]);
});

test('route choices exclude unavailable providers and groups, and preserve gateway references', () => {
  const state = {
    connected: true,
    providers: [
      { id: 'ready', ready: true, off: false },
      { id: 'off', ready: true, off: true },
      { id: 'missing', ready: false, off: false }
    ],
    models: [
      { id: 'ready/model', name: 'Model', provider: 'ready' },
      { id: 'off/model', name: 'Off', provider: 'off' },
      { id: 'missing/model', name: 'Missing', provider: 'missing' }
    ],
    groups: [
      { ref: 'group/fallback', name: 'Fallback', ready: true },
      { ref: 'group/empty', name: 'Empty', ready: false }
    ]
  } as MagpieState;
  assert.deepEqual(
    magpieChoices(state).map((m) => m.id),
    ['magpie:ready/model', 'magpie:group/fallback']
  );
  assert.deepEqual(magpieChoices({ ...state, connected: false }), []);
  assert.deepEqual(magpieChoices(undefined), []);
});

test('finished sign-ins release the controls while active flows retain their status check', () => {
  assert.equal(magpieSignInActive('waiting'), true);
  for (const state of [undefined, 'done', 'error', 'canceled', 'cancelled', 'complete', 'failed'])
    assert.equal(magpieSignInActive(state), false);
});

test('a use-only gateway offers its exact published models and group aliases without invented provider settings', () => {
  const state: MagpieState = {
    connected: true,
    mode: 'existing',
    location: 'local',
    ready: true,
    access: 'use',
    version: '',
    managementUrl: '',
    gatewayUrl: 'http://127.0.0.1:3425',
    shared: false,
    notice: '',
    problem: '',
    managedAvailable: true,
    providers: [],
    presets: [],
    groups: [],
    logins: [],
    calls: [],
    discoverySupported: false,
    models: [
      { id: 'provider/model', name: 'Published model', provider: '', images: false, kind: 'model' },
      { id: 'group/team', name: 'group/team', provider: '', images: false, kind: 'group' }
    ]
  };
  assert.deepEqual(magpieChoices(state), [
    { id: 'magpie:provider/model', name: 'Published model', group: false },
    { id: 'magpie:group/team', name: 'group/team (routing alias)', group: true }
  ]);
  assert.deepEqual(magpieChoices({ ...state, ready: false }), []);
  assert.deepEqual(magpieChoices({ ...state, connected: false }), []);
  assert.deepEqual(magpieChoices({ ...state, access: 'manage' }), []);
});

test('new Magpie setup uses included Pi without requiring another installed CLI', () => {
  for (const offered of [
    [
      { id: 'pi' as const, installed: true },
      { id: 'claude' as const, installed: false }
    ],
    [
      { id: 'pi' as const, installed: true },
      { id: 'claude' as const, installed: true },
      { id: 'codex' as const, installed: true }
    ]
  ])
    assert.equal(magpieRunner('claude', offered, false), 'pi');
  assert.equal(
    magpieRunner(
      'claude',
      [
        { id: 'pi', installed: false },
        { id: 'claude', installed: true }
      ],
      false
    ),
    'pi'
  );
  assert.equal(magpieRunner('claude', [{ id: 'claude', installed: true }], false), undefined);
});

test('an explicit supported runner is preserved while unsupported platform choices cannot carry over', () => {
  const tools = [
    { id: 'pi' as const, installed: true },
    { id: 'claude' as const, installed: true },
    { id: 'codex' as const, installed: true }
  ];
  assert.equal(magpieRunner('claude', tools, true), 'claude');
  assert.equal(magpieRunner('codex', tools, true), 'codex');
  assert.equal(magpieRunner('pi', tools, true), 'pi');
  assert.equal(
    magpieRunner(
      'codex',
      [
        { id: 'pi', installed: true },
        { id: 'claude', installed: true }
      ],
      true
    ),
    'pi'
  );
  assert.equal(magpieRunner('grok', tools, true), 'pi');
});

test('selected Magpie waits for gateway readiness even when the direct vendor login is ready', () => {
  const input = {
    throughMagpie: true,
    installed: true,
    tooOld: false,
    gatewayReady: false,
    directReady: true
  };
  assert.equal(officeAiReady(input), false);
  assert.equal(officeAiReady({ ...input, gatewayReady: true, directReady: false }), true);
  assert.equal(officeAiReady({ ...input, gatewayReady: true, installed: false }), false);
  assert.equal(officeAiReady({ ...input, gatewayReady: true, tooOld: true }), false);
  assert.equal(officeAiReady({ ...input, throughMagpie: false }), true);
});
