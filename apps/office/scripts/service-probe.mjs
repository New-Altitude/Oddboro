import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession, verifyService } from './service-identity.mjs';
try {
  if (process.argv[2] === '--stop') {
    const { ownerRequest } = await import('./service-channel.mjs');
    const line = readFileSync(0, 'utf8');
    if (!/^oddboro:key [0-9a-f]{64}$/.test(line)) throw Error();
    const res = await ownerRequest(
      process.argv[3],
      line.slice('oddboro:key '.length),
      'POST',
      '/service/stop',
      {}
    );
    res.resume();
    if (res.statusCode !== 200) throw Error();
  } else {
    const [home, port, version] = process.argv.slice(2);
    const session = await openSession(
      readFileSync(0, 'utf8'),
      JSON.parse(readFileSync(join(home, 'service.json'), 'utf8'))
    );
    if (session.port !== Number(port) || session.version !== version) throw Error();
    await verifyService(session);
    process.stdout.write(session.key);
  }
} catch {
  process.exitCode = 1;
}
