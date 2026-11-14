// Only Node and its native supervisor hold the startup pipes. A new
// credential travels back on that pipe once, to the owner who started it.
import { createHash } from 'node:crypto';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getSecret, secretStore, savePairing } from '@oddboro/ledger/secrets';
import { newPairing, sealSession } from '../../../scripts/service-identity.mjs';

export async function publishPairing(key: string) {
  const home = resolve(process.env.ODDBORO_HOME!);
  const slot = createHash('sha256').update(home).digest('hex');
  const marker = join(home, 'paired-office');
  const saved = getSecret('owner-pairing', slot);
  if (!saved && existsSync(marker))
    throw Error('This paired office needs its credential store to be open.');
  let registration;
  let credential;
  if (saved) registration = JSON.parse(saved);
  else {
    ({ credential, registration } = newPairing());
    if (secretStore().ok) {
      await savePairing(slot, JSON.stringify(registration));
      writeFileSync(marker, '1\n', { mode: 0o600 });
    }
  }
  const port = Number(process.env.PORT || process.env.ODDBORO_PORT || 4500);
  const version = process.env.ODDBORO_VERSION || 'development';
  const record = await sealSession(registration, { key, port, version });
  const file = join(home, 'service.json');
  const temp = file + '.' + process.pid;
  writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  renameSync(temp, file);
  if (credential) process.stdout.write('oddboro:pairing ' + credential + '\n');
}
