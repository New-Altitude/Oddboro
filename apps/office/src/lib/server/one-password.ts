// Resolve one field chosen on the owner's Desk. Only the office starts the CLI.
// A CLI error can include its output, so none of it goes into the error on the Desk.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { onPath } from './on-path.ts';
import { outsideToolEnv } from './run-env-allow.ts';

const run = promisify(execFile);

export async function readOnePasswordField(reference: string): Promise<string> {
  if (!/^op:\/\/[^/?#\s][^/?#\r\n]*(?:\/[^/?#\r\n]+){2,3}$/.test(reference))
    throw new Error('Copy the secret reference for one field from 1Password.');
  const op = onPath('op');
  if (!op) throw new Error('Install 1Password CLI on the computer running the office.');
  try {
    const env = outsideToolEnv();
    for (const name of ['OP_ACCOUNT', 'OP_CONFIG_DIR', 'OP_SERVICE_ACCOUNT_TOKEN']) {
      if (process.env[name]) env[name] = process.env[name]!;
    }
    const { stdout } = await run(op, ['read', '--no-newline', reference], {
      env,
      timeout: 45_000,
      maxBuffer: 64 * 1024,
      windowsHide: true
    });
    if (stdout) return stdout;
  } catch {
    // Both the CLI's stdout and stderr stay out of the error sent to the Desk.
  }
  throw new Error('1Password could not read that field. Check the reference and your CLI access.');
}
