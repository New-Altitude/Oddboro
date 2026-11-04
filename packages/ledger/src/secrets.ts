// Secrets the owner connects (API keys, sign-ins) live in the system's own
// secret store, never in Postgres or a file. Each system has one entry below,
// through the tool it ships with: the Keychain on a Mac through `security`,
// and on Linux the desktop keyring through `secret-tool` (libsecret), which
// talks to any keyring that speaks the Secret Service (GNOME Keyring,
// KWallet, KeePassXC). On Windows it is the Credential Manager, through the
// PasswordVault that Windows PowerShell can reach with nothing to install.
// Every secret sits under the service "oddboro", named "<connector>:<NAME>".
import { execFileSync } from 'node:child_process';
import { SYSTEM, powershellSync, type System } from './platform.ts';

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

// The names reach the script as environment variables and the value on
// stdin, so nothing needs quoting and the value never shows in the process
// list. Retrieve fails when there is no such secret.
const VAULT =
  '[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];' +
  '$v = New-Object Windows.Security.Credentials.PasswordVault;';
const vault = (script: string, account: string, input?: string) =>
  powershellSync(VAULT + script, { ODDBORO_SERVICE: SERVICE, ODDBORO_ACCOUNT: account }, input);
const credentialManager: Store = {
  // Add replaces a credential already under the same names.
  set: (account, value) =>
    void vault(
      '$v.Add((New-Object Windows.Security.Credentials.PasswordCredential($env:ODDBORO_SERVICE, $env:ODDBORO_ACCOUNT, [Console]::In.ReadToEnd())))',
      account,
      value
    ),
  get: (account) =>
    vault(
      '$c = $v.Retrieve($env:ODDBORO_SERVICE, $env:ODDBORO_ACCOUNT); $c.RetrievePassword(); [Console]::Out.Write($c.Password)',
      account
    ),
  remove: (account) =>
    void vault('$v.Remove($v.Retrieve($env:ODDBORO_SERVICE, $env:ODDBORO_ACCOUNT))', account),
  check: () => void vault('[void]$v', '')
};

const STORES: Record<System, Store | undefined> = {
  mac: keychain,
  linux: secretService,
  windows: credentialManager
};
const store = SYSTEM && STORES[SYSTEM];

export function setSecret(connector: string, name: string, value: string): void {
  if (!store) throw new Error('This system has no secret store the office can use.');
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
  if (!store) return { ok: false, problem: `not known on ${process.platform}` };
  try {
    store.check();
    return { ok: true };
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, problem: missing ? 'not installed' : 'did not answer' };
  }
}
