// Which New Altitude persona a hire proposal names, and when the hire window
// offers it in place of the builder. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HireProposal } from '@oddboro/ledger';
import {
  hasPersonaHint,
  ordinaryFrom,
  proposalView,
  proposedPersona,
  suggestedPersona,
  withoutLikeness,
  type Offer
} from './persona.ts';

const offer = (slug: string, displayName: string, name: string): Offer => ({
  slug,
  displayName,
  jobTitle: null,
  disclosure: '',
  name,
  role: 'Persona',
  remit: '',
  portrait: '',
  joined: 'no'
});

const pat = offer('pat-q-rivers', 'Pat Q. Rivers', 'Pat');
const rowan = offer('rowan-hale', 'Rowan Hale', 'Rowan');
const offers = [pat, rowan];

const proposal = (p: Partial<HireProposal>): HireProposal => ({
  name: 'Mira',
  role: 'Mail Clerk',
  permission: 'read',
  remit: 'Sorts the mail',
  jobDescriptionFile: 'notes/jd.md',
  ...p
});

test('a proposal finds its persona by slug', () => {
  assert.equal(
    proposedPersona({ name: 'Mira', role: 'Strategy', personaSlug: 'rowan-hale' }, offers),
    rowan
  );
});

test('a proposal finds its persona by the whole name in its role or its name', () => {
  assert.equal(proposedPersona({ name: 'Pat', role: 'Pat Q. Rivers Persona' }, offers), pat);
  assert.equal(proposedPersona({ name: 'Pat', role: 'pat q rivers persona' }, offers), pat);
  assert.equal(proposedPersona({ name: 'Rowan Hale', role: 'Advisor' }, offers), rowan);
  assert.equal(proposedPersona({ name: 'Mira', role: 'Rowan Hale' }, offers), rowan);
});

test('a slug New Altitude does not offer falls back to the whole name', () => {
  assert.equal(
    proposedPersona(
      { name: 'Pat', role: 'Pat Q. Rivers Persona', personaSlug: 'pat-rivers' },
      offers
    ),
    pat
  );
  assert.equal(
    proposedPersona({ name: 'Mira', role: 'Mail Clerk', personaSlug: 'nobody' }, offers),
    undefined
  );
});

test('a first name alone, or a name inside a longer role, never matches', () => {
  assert.equal(proposedPersona({ name: 'Pat', role: 'Mail Clerk' }, offers), undefined);
  assert.equal(
    proposedPersona({ name: 'Mira', role: "Pat's Research Assistant" }, offers),
    undefined
  );
  assert.equal(
    proposedPersona({ name: 'Mira', role: 'Rowan Hale Fan Club Lead' }, offers),
    undefined
  );
  assert.equal(proposedPersona({ name: 'Mira', role: 'Persona' }, offers), undefined);
});

test('a middle initial does not count, on either side, but a first name alone never matches', () => {
  const nate = offer('nate', 'Nate B. Jones', 'Nate');
  const list = [nate, rowan];
  assert.equal(proposedPersona({ name: 'Nate', role: 'Nate Jones Persona' }, list), nate);
  assert.equal(proposedPersona({ name: 'Nate B Jones', role: 'Advisor' }, list), nate);
  assert.equal(proposedPersona({ name: 'Mira', role: 'Rowan T. Hale Persona' }, list), rowan);
  assert.equal(proposedPersona({ name: 'Nate', role: 'Advisor' }, list), undefined);
  assert.equal(proposedPersona({ name: 'Nate', role: 'Nate Persona' }, list), undefined);
  assert.equal(proposedPersona({ name: 'Mira', role: 'Nate Smith Persona' }, list), undefined);
});

test('two matches are none', () => {
  assert.equal(
    proposedPersona({ name: 'Rowan Hale', role: 'Pat Q. Rivers Persona' }, offers),
    undefined
  );
  const twin = offer('pat-q-rivers-2', 'Pat Q. Rivers', 'Pat');
  assert.equal(
    proposedPersona({ name: 'Pat', role: 'Pat Q. Rivers Persona' }, [pat, twin]),
    undefined
  );
});

test('the hire window offers the persona a proposal names, and only with a list of offers', () => {
  const named = proposal({ name: 'Pat', role: 'Pat Q. Rivers Persona' });
  assert.equal(suggestedPersona(named, { state: 'ok', offers }), pat);
  // Signed out, or New Altitude without a list: the builder, as before.
  assert.equal(suggestedPersona(named, { state: 'out' }), undefined);
  assert.equal(suggestedPersona(named, { state: 'unreachable' }), undefined);
  assert.equal(suggestedPersona(named, undefined), undefined);
  // No such persona on offer, or no proposal: the builder.
  assert.equal(suggestedPersona(proposal({}), { state: 'ok', offers }), undefined);
  assert.equal(suggestedPersona(named, { state: 'ok', offers: [rowan] }), undefined);
  assert.equal(suggestedPersona(undefined, { state: 'ok', offers }), undefined);
});

test('an ordinary Odd built instead keeps none of the person', () => {
  assert.deepEqual(withoutLikeness({ name: 'Pat', role: 'Pat Q. Rivers Persona' }, pat), {
    name: '',
    role: '',
    appearance: ''
  });
  assert.deepEqual(withoutLikeness({ name: 'Mira', role: 'Strategy Advisor' }, pat), {
    name: 'Mira',
    role: 'Strategy Advisor',
    appearance: ''
  });
});

test('a proposal that may name a persona waits for the offers, and any other opens the builder at once', () => {
  assert.equal(hasPersonaHint({ name: 'Pat', role: 'Pat Q. Rivers Persona' }), true);
  assert.equal(hasPersonaHint({ name: 'Pat Rivers', role: 'Advisor' }), true);
  assert.equal(hasPersonaHint({ name: 'Mira', role: 'Mail Clerk', personaSlug: 'pat' }), true);
  assert.equal(hasPersonaHint({ name: 'Mira', role: 'Mail Clerk' }), false);

  const named = proposal({ name: 'Pat', role: 'Pat Q. Rivers Persona' });
  // Not answered yet: nothing shows, so the builder never flashes.
  assert.equal(proposalView(named, undefined), 'wait');
  assert.equal(proposalView(named, { state: 'ok', offers }), 'persona');
  assert.equal(proposalView(named, { state: 'ok', offers: [rowan] }), 'not-offered');
  // No hint, or no proposal: the builder at once.
  assert.equal(proposalView(proposal({}), undefined), 'odd');
  assert.equal(proposalView(undefined, undefined), 'odd');
});

test('a proposal that says it means a persona asks for the sign-in, or says why it cannot show one', () => {
  const named = proposal({ name: 'Pat', role: 'Pat Q. Rivers Persona' });
  const bySlug = proposal({ name: 'Mira', role: 'Advisor', personaSlug: 'pat-q-rivers' });
  for (const p of [named, bySlug]) {
    assert.equal(proposalView(p, { state: 'out' }), 'sign-in');
    assert.equal(proposalView(p, { state: 'rescope' }), 'sign-in');
    assert.equal(proposalView(p, { state: 'unreachable' }), 'unreachable');
    assert.equal(proposalView(p, { state: 'ok', offers: [rowan] }), 'not-offered');
    assert.equal(proposalView(p, { state: 'ok', offers }), 'persona');
  }
  // A whole name alone is a weaker hint: signed out or unreachable, the builder at once.
  const weak = proposal({ name: 'Pat Rivers', role: 'Advisor' });
  assert.equal(proposalView(weak, { state: 'out' }), 'odd');
  assert.equal(proposalView(weak, { state: 'unreachable' }), 'odd');
});

test('the builder from a proposal that named a persona never carries the person', () => {
  const blank = { name: '', role: '', appearance: '' };
  assert.deepEqual(
    ordinaryFrom({ name: 'Nate', role: 'Nate Jones Persona', appearance: 'Short hair, glasses' }),
    blank
  );
  assert.deepEqual(
    ordinaryFrom({ name: 'Nate', role: 'Advisor', appearance: 'Glasses', personaSlug: 'nate' }),
    blank
  );
  // Matched by name alone: the person's own name and role go, the rest stays.
  assert.deepEqual(
    ordinaryFrom({ name: 'Pat Q. Rivers', role: 'Advisor', appearance: 'Tall' }, pat),
    { name: '', role: 'Advisor', appearance: '' }
  );
  // Nothing of a persona: the proposal as it is.
  assert.deepEqual(ordinaryFrom({ name: 'Mira', role: 'Mail Clerk', appearance: 'Tall' }), {
    name: 'Mira',
    role: 'Mail Clerk',
    appearance: 'Tall'
  });
});
