import { test } from 'node:test';
import { officeCapabilities } from './office-capabilities.ts';
test('the manager sees current offers and installed identities, with no inferred name mapping', (t) => {
  t.assert.snapshot(
    officeCapabilities({
      tools: ['request_persona', 'hand_off'],
      account: 'in',
      offersState: 'ok',
      offers: [{ slug: 'pat', name: 'Pat Example' }],
      installed: [{ id: 'old-pat', slug: 'pat', quiet: 'grant' }]
    })
  );
});
test('signed out capabilities point to the conversation account action', (t) => {
  t.assert.snapshot(
    officeCapabilities({
      tools: ['request_persona'],
      account: 'out',
      offersState: 'out',
      offers: [],
      installed: []
    })
  );
});
