// The office keeps an owner's field reference apart from a pasted key. Neither
// a connector manifest nor a value that happens to start with op:// selects it.
import { deleteSecret, getSecret, setSecret } from './secrets.ts';

const slot = (connector: string) => `1password/${connector}`;

export function fieldReference(connector: string, name: string): string | undefined {
  return getSecret(slot(connector), name);
}

export function keepFieldReference(connector: string, name: string, reference: string): void {
  setSecret(slot(connector), name, reference);
}

export function forgetFieldReference(connector: string, name: string): boolean {
  return !!fieldReference(connector, name) && deleteSecret(slot(connector), name);
}
