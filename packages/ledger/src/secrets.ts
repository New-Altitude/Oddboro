// Secrets the owner connects (API keys, sign-ins) live in the system's own
// secret store, never in Postgres or a file. Each system has one entry below,
// through the tool it ships with: the Keychain on a Mac through `security`,
// and on Linux the desktop keyring through `secret-tool` (libsecret), which
// talks to any keyring that speaks the Secret Service (GNOME Keyring,
// KWallet, KeePassXC). Windows ships no command that reads a secret back, so
// there the office keeps them in the Credential Manager through the keyring
// package, loaded only on Windows. Every secret sits under the service
// "oddboro", named "<connector>:<NAME>".
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { SYSTEM, type System } from './platform.ts';
import { fixedError } from './errors.ts';

const SERVICE = 'oddboro';

/** One system's secret store. `get` and `remove` throw when there is no such secret. */
type Store = {
  set(account: string, value: string): void;
  get(account: string): string;
  remove(account: string): void;
  /** Throws when the store cannot be reached. */
  check(): void;
};

const read = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const quiet = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'ignore' });

const keychain: Store = {
  set: (account, value) =>
    quiet('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value]),
  // security ends the value with a line break.
  get: (account) =>
    read('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']).trimEnd(),
  remove: (account) => quiet('security', ['delete-generic-password', '-s', SERVICE, '-a', account]),
  check: () => quiet('security', ['default-keychain'])
};

const secretService: Store = {
  // secret-tool reads the value on stdin, so it never shows in the process list.
  set: (account, value) => {
    execFileSync(
      'secret-tool',
      ['store', '--label', `Oddboro ${account}`, 'service', SERVICE, 'account', account],
      { input: value, stdio: ['pipe', 'ignore', 'pipe'] }
    );
  },
  // secret-tool prints the value as stored and fails when there is none.
  get: (account) => read('secret-tool', ['lookup', 'service', SERVICE, 'account', account]),
  remove: (account) => {
    secretService.get(account);
    quiet('secret-tool', ['clear', 'service', SERVICE, 'account', account]);
  },
  // A search that finds nothing still succeeds; one with no keyring to ask fails.
  check: () => quiet('secret-tool', ['search', 'service', SERVICE])
};

type Entry = {
  setSecret(secret: Uint8Array): void;
  getSecret(): number[] | null;
  deletePassword(): boolean;
};
type Keyring = { Entry: new (service: string, account: string) => Entry };

/**
 * The Credential Manager holds at most 2,560 bytes in one credential, and a
 * sign-in's saved JSON can run longer. So a value goes in as UTF-8 in pieces:
 * the first credential holds how many pieces there are, a line break, then
 * the first piece; the rest follow as "<account>#1", "#2" and on.
 */
const PIECE = 2048;
function credentialManager(): Store {
  const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring') as Keyring;
  const entry = (account: string, i: number) => new Entry(SERVICE, i ? `${account}#${i}` : account);
  const read = (account: string, i: number) => {
    const bytes = entry(account, i).getSecret();
    if (!bytes) throw new Error(`No secret named ${account}`);
    return Buffer.from(bytes);
  };
  /** Removes pieces from `from` on, until one is missing. */
  const drop = (account: string, from: number) => {
    for (let i = from; entry(account, i).deletePassword(); i++);
  };
  return {
    set(account, value) {
      const bytes = Buffer.from(value, 'utf8');
      const count = Math.max(1, Math.ceil(bytes.length / PIECE));
      for (let i = count - 1; i >= 0; i--) {
        const piece = bytes.subarray(i * PIECE, (i + 1) * PIECE);
        entry(account, i).setSecret(i ? piece : Buffer.concat([Buffer.from(`${count}\n`), piece]));
      }
      drop(account, count);
    },
    get(account) {
      const first = read(account, 0);
      const nl = first.indexOf(10);
      const count = Number(first.subarray(0, nl));
      const pieces = [first.subarray(nl + 1)];
      for (let i = 1; i < count; i++) pieces.push(read(account, i));
      return Buffer.concat(pieces).toString('utf8');
    },
    remove(account) {
      read(account, 0);
      drop(account, 0);
    },
    // Reading a name that is not there answers null; a store that cannot be reached throws.
    check: () => void entry('check', 0).getSecret()
  };
}

const STORES: Record<System, (() => Store) | undefined> = {
  mac: () => keychain,
  linux: () => secretService,
  windows: credentialManager
};
/** This system's store, or none when it has none or it would not load. */
const store = ((): Store | undefined => {
  try {
    return SYSTEM ? STORES[SYSTEM]?.() : undefined;
  } catch {
    return undefined;
  }
})();

export function setSecret(connector: string, name: string, value: string): void {
  if (!store) throw fixedError('This system has no secret store the office can use yet.');
  store.set(`${connector}:${name}`, value);
}

export function getSecret(connector: string, name: string): string | undefined {
  try {
    return store?.get(`${connector}:${name}`) || undefined;
  } catch {
    return undefined;
  }
}

/** Remove a secret; true when there was one. */
export function deleteSecret(connector: string, name: string): boolean {
  try {
    store?.remove(`${connector}:${name}`);
    return !!store;
  } catch {
    return false;
  }
}

/** Whether this computer has a secret store the office can use, and why not when it has none. */
export function secretStore(): { ok: true } | { ok: false; problem: string } {
  if (!store) return { ok: false, problem: 'not found on this system' };
  try {
    store.check();
    return { ok: true };
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, problem: missing ? 'not installed' : 'did not answer' };
  }
}
