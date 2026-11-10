// The page's request helper. The built server refuses a POST or DELETE with
// no content type as a cross-site form, so every request that changes
// something must say JSON. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { call } from './api.ts';

/** The requests `call` sent, answered with `{}`. */
function sent(t: TestContext): RequestInit[] {
  const seen: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    seen.push(init);
    return Response.json({});
  });
  return seen;
}

test('a request that changes something says JSON even with no body, and a GET says nothing', async (t) => {
  const seen = sent(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) await call('/api/x', undefined, method);
  await call('/api/x', { a: 1 }, 'PUT');
  await call('/api/x');
  assert.deepEqual(
    seen.map((r) => [r.method, r.headers, r.body]),
    [
      ['POST', { 'content-type': 'application/json' }, undefined],
      ['PUT', { 'content-type': 'application/json' }, undefined],
      ['PATCH', { 'content-type': 'application/json' }, undefined],
      ['DELETE', { 'content-type': 'application/json' }, undefined],
      ['PUT', { 'content-type': 'application/json' }, '{"a":1}'],
      ['GET', undefined, undefined]
    ]
  );
});
