import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession, verifyService } from './service-identity.mjs';
try {
  const [home, port, version] = process.argv.slice(2);
  const session = await openSession(
    readFileSync(0, 'utf8'),
    JSON.parse(readFileSync(join(home, 'service.json'), 'utf8'))
  );
  if (session.port !== Number(port) || session.version !== version) throw Error();
  await verifyService(session);
  process.stdout.write(session.key);
} catch {
  process.exitCode = 1;
}
