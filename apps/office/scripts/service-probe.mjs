import { findService } from './service-identity.mjs';

const [home, port, version] = process.argv.slice(2);
try {
  if (!(await findService(home, Number(port), version))) process.exitCode = 1;
} catch {
  // An office that is still starting or no longer listening cannot be attached yet.
  process.exitCode = 1;
}
