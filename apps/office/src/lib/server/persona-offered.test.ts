// What an Odd that can propose a hire hears of the personas New Altitude
// offers. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heardOffers, offeredSection } from './persona-offered.ts';

const pat = { slug: 'pat', displayName: 'Pat Q. Rivers' };
const rowan = { slug: 'rowan', displayName: 'Rowan Hale' };

test('no list, no section', () => {
  heardOffers(undefined);
  assert.equal(offeredSection(new Set()), '');
  heardOffers([]);
  assert.equal(offeredSection(new Set()), '');
});

test('each persona on offer by name and slug, with how to propose it', () => {
  heardOffers([pat, rowan]);
  assert.equal(
    offeredSection(new Set()),
    '\n## New Altitude personas\n\n- New Altitude offers {owner} these real people as personas, published with their consent: Pat Q. Rivers (pat), Rowan Hale (rowan). When {owner} asks to hire one, call propose_hire with its persona_slug, and {owner} adds the real persona from the hire window. Never build a look-alike Odd of a real person.\n'
  );
});

test('a persona already here is said to be here, not offered', () => {
  heardOffers([pat, rowan]);
  const one = offeredSection(new Set(['pat']));
  assert.match(one, /: Rowan Hale \(rowan\)\./);
  assert.doesNotMatch(one, /Pat Q\. Rivers \(pat\)/);
  assert.match(one, /Already working here as personas: Pat Q\. Rivers\.\n$/);
  assert.equal(
    offeredSection(new Set(['pat', 'rowan'])),
    '\n## New Altitude personas\n\n- Already working here as personas: Pat Q. Rivers, Rowan Hale.\n'
  );
});
