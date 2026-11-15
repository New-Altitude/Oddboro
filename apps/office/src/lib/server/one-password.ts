// The owner selects one field. Its value and any CLI error output stay out
// of the Desk. Only the connector gets the resolved value.
import { probe } from '@oddboro/ledger/platform';
import { outsideToolEnv } from './run-env-allow.ts';

export async function readOnePasswordField(reference: string): Promise<string> {
  if (!/^op:\/\/[^/?#\s][^/?#\r\n]*(?:\/[^/?#\r\n]+){2,3}$/.test(reference))
    throw new Error('Copy the secret reference for one field from 1Password.');
  const env = outsideToolEnv();
  for (const name of ['OP_ACCOUNT', 'OP_CONFIG_DIR', 'OP_SERVICE_ACCOUNT_TOKEN']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const result = await probe('op', ['read', '--no-newline', reference], {
    env,
    timeout: 45_000,
    maxBuffer: 64 * 1024
  });
  if (result.status === 'missing')
    throw new Error('Install 1Password CLI on the computer running the office.');
  if (result.status === 'ok' && result.out) return result.out;
  throw new Error('1Password could not read that field. Check the reference and your CLI access.');
}
