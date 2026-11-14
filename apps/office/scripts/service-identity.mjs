import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @param {string} home */
export const identityFile = (home) => resolve(home, 'service.json');

/** @param {string} key @param {string} challenge */
export function proof(key, challenge) {
  return createHmac('sha256', key)
    .update('Oddboro office service\n')
    .update(challenge)
    .digest('hex');
}

/** @param {string} home @param {number} port @param {string} version */
export async function findService(home, port, version) {
  let saved;
  try {
    saved = JSON.parse(readFileSync(identityFile(home), 'utf8'));
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return;
    throw e;
  }
  if (saved.port !== port || !/^[a-f0-9]{64}$/.test(saved.key)) return;
  const challenge = randomBytes(32).toString('hex');
  const response = await fetch(`http://127.0.0.1:${port}/api/health?challenge=${challenge}`, {
    signal: AbortSignal.timeout(1800),
    redirect: 'error'
  });
  if (!response.ok) return;
  const h = await response.json();
  if (h.version !== version || h.readyMs == null || typeof h.proof !== 'string') return;
  const got = Buffer.from(h.proof, 'hex');
  const want = Buffer.from(proof(saved.key, challenge), 'hex');
  if (got.length === want.length && timingSafeEqual(got, want)) return saved;
}
