// What a run's commands reach, for Claude Code and Codex alike: the
// variables they never see, Claude Code's sandbox, and the owner's developer
// tool folders they read. And how a run tells that Claude Code refused the
// open network; the hold that follows lives in the ledger (`holdNetwork`), so
// every reader of an Odd's reach sees it. Server only.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { CODE, GLOB, home, SECRET_STORES, within } from '@oddboro/ledger';
import { sandboxPaths } from './sandbox-paths.ts';
import { gitEnv } from './launch.ts';

/** Every host, for commands when Run commands and Browse the web are both on (measured on Claude Code 2.1.318). */
export const OPEN_NETWORK: string[] = ['*'];
/**
 * The names of this Mac that hold whatever its network: the loopback names and
 * the any-address in both families, where a server on every address answers.
 * Measured on Claude Code 2.1.318: its proxy matches exact hosts and resolved
 * addresses, not ranges (`127.0.0.0/8` in place of `127.0.0.1` let
 * `127.0.0.1` through), and refuses `::ffff:` forms and any name that resolves
 * to a listed address (`localtest.me`, `127.0.0.1.nip.io`).
 */
export const MAC_NAMES: string[] = [
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '::',
  '[::]'
];

/**
 * Every address of this Mac, which commands never reach even with every host
 * open: the office's API and database listen here, and anything listening on
 * every address (the office's own Caddy on a Mac) is one hop from them, so a
 * command could otherwise change the office behind the owner's back. That is
 * `MAC_NAMES`, each address of each interface in `interfaces`, IPv6 bare and
 * in brackets, as the proxy takes both, and this Mac's own names from `host`
 * (`os.hostname()`): that exact string, and the bare name (before the first
 * dot) alone and with `.local`, lowercased, since `<name>.local` resolves to
 * this Mac. Read per run, so an address the Mac gets later is listed from the
 * next run; one that comes during a run is not. Other `127.x` addresses and
 * other machines on the network stay open.
 */
export function macAddresses(
  interfaces: ReturnType<typeof networkInterfaces>,
  host: string
): string[] {
  const all = new Set(MAC_NAMES);
  for (const list of Object.values(interfaces))
    for (const { family, address } of list ?? [])
      for (const a of family === 'IPv6' ? [address, `[${address}]`] : [address]) all.add(a);
  const bare = host.split('.')[0].toLowerCase();
  for (const name of [host, bare, `${bare}.local`]) all.add(name);
  return [...all];
}
/**
 * Claude Code's words when it refuses that open form, as its binary carries
 * them. 2.1.318 took `*.com` in `--settings` and loaded a page, so how a
 * refusal shows in a run is not yet seen; these are the words to look for.
 */
export const NETWORK_REFUSED = /Overly broad patterns/;

/**
 * What the owner reads on the run that met a refusal, with the Odd's name for
 * `{name}`. Only a message the owner sent can be sent again: the chat drops
 * it when its run fails. Nothing tries any other run again: a job waits for
 * its next time, and a hand-off's failure goes back to the Odd that handed it.
 */
export const NETWORK_REFUSED_LINE = {
  sent: "This version of Claude Code will not let commands reach the internet, so {name}'s commands now run with no network. Send your message again.",
  unsent:
    "This version of Claude Code will not let commands reach the internet, so {name}'s commands now run with no network. This run stopped and is not tried again."
};

/** A variable's name that says it may hold a secret. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE)/i;
/** The office's own git settings (`gitEnv`), by name; the folder they name does not matter here. */
const OFFICE_GIT = new Set(Object.keys(gitEnv('')));

/**
 * The variables of a run's environment (`env`) that its sandboxed commands
 * never see: the API key, the database's address, and every name that says
 * it may hold a secret. Claude Code itself keeps them: a key sign-in needs
 * the key. A second wall behind the allow list (`runEnv`), which lets none of
 * the office's own secrets into `env`; the tool server gets `DATABASE_URL` on
 * its own entry. `CLAUDE_CODE_MESSAGING_TOKEN` is named too: Claude Code sets it itself, so
 * it is never in `env`, and a walk saw it in Bash's `env`. The office's own
 * git settings pass by exact name (`OFFICE_GIT`): `GIT_CONFIG_KEY_0` and
 * `_1` say key, and git with one of them hidden or empty stops every command
 * with exit 128. The office's own `GIT_` variables never reach `env`
 * (`runEnv` lists none), so today the exact names act as a `GIT_` prefix
 * would, and no test can tell the two apart. Still by exact name, so a
 * `GIT_..._TOKEN` a later change puts in `env` after `runEnv` stays hidden
 * like every other name that looks like a secret.
 */
export function hiddenFromCommands(env: NodeJS.ProcessEnv): string[] {
  const names = Object.keys(env).filter(
    (n) => !OFFICE_GIT.has(n) && (SECRET_NAME.test(n) || n === 'DATABASE_URL')
  );
  return [...new Set(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_MESSAGING_TOKEN', ...names])];
}

/**
 * Claude Code's sandbox for a run's commands: reads only what the run reads
 * (`reads`), the owner's developer tool folders (`devReads`), the commands'
 * own temp folder (`tmp`) and the system's own folders; writes as run() says,
 * never what `denyWrite` names; no network unless Browse the web is on
 * (`network`), and never an address of this Mac (`macAddresses`); and none
 * of the secrets in the run's environment (`env`).
 */
export function claudeSandbox(o: {
  reads: string[];
  tmp: string;
  denyWrite: string[];
  network: boolean;
  env: NodeJS.ProcessEnv;
}): Record<string, unknown> {
  // Commands run on node, which may be installed under the home folder.
  const node = dirname(dirname(process.execPath));
  const dev = devReads();
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      // Every home folder and every other disk, not only the owner's home.
      denyRead: ['~/', ...sandboxPaths().denyReadRoots, ...dev.denies, ...dev.globDenies],
      allowRead: [
        ...o.reads,
        o.tmp,
        ...(node.startsWith(homedir() + sep) ? [node] : []),
        ...dev.reads
      ],
      denyWrite: o.denyWrite
    },
    network: o.network
      ? {
          allowedDomains: OPEN_NETWORK,
          deniedDomains: macAddresses(networkInterfaces(), hostname())
        }
      : { allowedDomains: [] },
    credentials: {
      envVars: hiddenFromCommands(o.env).map((name) => ({ name, mode: 'deny' }))
    }
  };
}

/** Developer tool folders under the home folder that commands may read. */
export const DEV_FOLDERS = [
  '.npm',
  '.nvm',
  '.volta',
  '.pyenv',
  '.rbenv',
  '.cargo',
  '.rustup',
  '.bun',
  '.deno',
  'go',
  '.gradle',
  '.m2',
  '.gem',
  '.local/bin'
] as const;

/**
 * Files and folders inside them that commands never read, under the home
 * folder: each holds a token, or is a config its tool reads one from (Gradle
 * runs every script in `init.d`).
 */
export const DEV_SECRETS = [
  '.cargo/credentials',
  '.cargo/credentials.toml',
  '.cargo/config',
  '.cargo/config.toml',
  '.gradle/gradle.properties',
  '.gradle/init.gradle',
  '.gradle/init.gradle.kts',
  '.gradle/init.d',
  '.m2/settings.xml',
  '.m2/settings-security.xml',
  '.gem/credentials'
] as const;

/**
 * Folders each of whose entries holds a file commands never read: the
 * developer tool folder, the folder inside it, and the file inside each
 * entry. npm's global config in each node version nvm and Volta keep, each
 * Gradle init script, and the config of each repository Go keeps for a
 * module fetched from its source and Cargo keeps for a git dependency, whose
 * remote's address can carry a token.
 */
const EACH_ENTRY: [folder: string, inside: string[], file: string[]][] = [
  ['.nvm', ['versions', 'node'], ['etc', 'npmrc']],
  ['.volta', ['tools', 'image', 'node'], ['etc', 'npmrc']],
  ['.gradle', ['init.d'], []],
  ['go', ['pkg', 'mod', 'cache', 'vcs'], ['config']],
  ['.cargo', ['git', 'db'], ['config']]
];
/**
 * What Claude Code's commands never read under every developer tool folder,
 * as globs: env files, and each project's git config, whose remote's address
 * can carry a token.
 */
const FOLDER_GLOBS = ['**/.env', '**/.env.*', '**/.git/config'];

/**
 * What commands read of the owner's developer tools this run, by real path:
 * the folders that exist, and the file each link in `~/.local/bin` leads to
 * elsewhere in the home, never its folder; and the files they never read
 * (`denies`): `DEV_SECRETS` and the file in each entry `EACH_ENTRY` names,
 * listed per run so a node version installed later is shut from the next
 * run. `globDenies` shuts `FOLDER_GLOBS` under each folder read, and the file
 * in every entry of an `EACH_ENTRY` folder by a single `*`, so one made during
 * a run is shut too. Only Claude Code's sandbox takes globs, since none was
 * measured in Codex's profile, so a Codex Odd's commands can still read an
 * env file or a project's git config there, and an entry made during a run.
 * The home is read when called, never at import, since tests move it.
 *
 * A folder or link target is left out when it is in or holds a secret store,
 * the office's home or Oddboro's code (as `checkFolder` refuses one), so a
 * link never opens `~/.claude` and a folder never the whole home. One whose real path holds `*`,
 * `?`, `[` or `]` is left out too, with its denies: Codex reads such a path
 * as a glob and will not start (`GLOB`). A deny names the file whether it
 * exists or not, so one made during the run stays shut; both tools start
 * with a deny on a missing file (measured).
 */
export function devReads(): { reads: string[]; denies: string[]; globDenies: string[] } {
  const h = realpathSync.native(homedir());
  const shut = [...SECRET_STORES.map((s) => join(h, s)), home(), CODE].map((p) =>
    existsSync(p) ? realpathSync.native(p) : p
  );
  const reads: string[] = [];
  /** Reads `p` unless it is left out; whether commands read it, here or by a folder already read. */
  const add = (p: string): boolean => {
    if (GLOB.test(p) || p === h) return false;
    if (shut.some((s) => within(p, s) || within(s, p))) return false;
    if (!reads.some((r) => within(p, r))) reads.push(p);
    return true;
  };
  /** Each listed folder commands read, by its real path. */
  const folders = new Map<string, string>();
  for (const f of DEV_FOLDERS) {
    const p = join(h, f);
    if (!existsSync(p)) continue;
    const real = realpathSync.native(p);
    if (add(real)) folders.set(f, real);
  }
  const bin = folders.get('.local/bin');
  if (bin)
    for (const e of readdirSync(bin, { withFileTypes: true })) {
      const link = join(bin, e.name);
      // A link to nothing has nothing to read.
      if (!e.isSymbolicLink() || !existsSync(link)) continue;
      const target = realpathSync.native(link);
      if (within(target, h)) add(target);
    }
  const denies = DEV_SECRETS.flatMap((s) => {
    const [first, ...rest] = s.split('/');
    const real = folders.get(first);
    return real ? [join(real, ...rest)] : [];
  });
  const globDenies = [...folders.values()].flatMap((f) => FOLDER_GLOBS.map((g) => join(f, g)));
  for (const [folder, inside, file] of EACH_ENTRY) {
    const real = folders.get(folder);
    if (!real) continue;
    const each = join(real, ...inside);
    globDenies.push(join(each, '*', ...file));
    if (existsSync(each)) for (const e of readdirSync(each)) denies.push(join(each, e, ...file));
  }
  return { reads, denies, globDenies };
}
