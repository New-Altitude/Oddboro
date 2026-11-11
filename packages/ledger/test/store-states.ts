// Every state the folder check for secret stores has to get right, one table
// that the check, what a run is given, the card's line and `ask_for_folder`
// all read (`store-states.test.ts`, `folder-asks.test.ts` and the office's
// `profile.test.ts`).
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type StoreState = {
  state: string;
  refused: boolean;
  /** Only in the home, not the same outside it. Left out, it holds in both. */
  homeOnly?: true;
  /** A case variant only a disk that ignores case makes the same folder. */
  macDisk?: true;
  /** Builds the state under `at` (the home, or a folder outside it) and gives the folder to judge. */
  make: (at: string, home: string) => string;
};

/** Makes `path` under `at`, with each of `files` inside it (a trailing `/` makes a folder), and gives back `path`. */
function folderWith(at: string, path: string, files: string[] = []): string {
  const p = join(at, path);
  mkdirSync(p, { recursive: true });
  for (const f of files) {
    const file = join(p, f);
    if (f.endsWith('/')) mkdirSync(file, { recursive: true });
    else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '');
    }
  }
  return p;
}

/** A row for `path` under `at` holding `files`, judged at `path`. */
const is = (state: string, refused: boolean, path: string, files: string[]): StoreState => ({
  state,
  refused,
  make: (at) => folderWith(at, path, files)
});

/** A row for a folder at `holder` that directly holds `store` with `files`. */
const holds = (
  state: string,
  refused: boolean,
  holder: string,
  store: string,
  files: string[]
): StoreState => ({
  state,
  refused,
  make: (at) => {
    folderWith(at, join(holder, store), files);
    return join(at, holder);
  }
});

/** The home's own store made under `home`, to link to. */
const ownStore = (home: string, store: string, files: string[]) => folderWith(home, store, files);

export const STORE_STATES: StoreState[] = [
  // A real store, nested: refused, whatever the owner accepts.
  is('a .ssh with a key is refused', true, 'old-mac/.ssh', ['id_ed25519']),
  holds('a folder directly holding a .ssh with a key is refused', true, 'old-mac-holder', '.ssh', [
    'id_rsa'
  ]),
  is('a folder inside a .ssh with a key is refused', true, 'old-mac-sub/.ssh/sub', ['../id_ecdsa']),
  is('a .docker with config.json is refused', true, 'old-mac-docker/.docker', ['config.json']),
  is('a .kube with config is refused', true, 'code/x-kube/.kube', ['config']),
  is('a .config with gcloud is refused', true, 'backup/.config', ['gcloud/']),

  // An ordinary project that shares a store's name: given.
  holds('a project with .aws/task-definition.json is given', false, 'code/x-aws', '.aws', [
    'task-definition.json'
  ]),
  is('that .aws of its own is given', false, 'code/x-aws-self/.aws', ['task-definition.json']),
  holds('a project with an empty .ssh is given', false, 'code/x-ssh', '.ssh', []),
  holds(
    'a project with a .ssh holding only a config is given',
    false,
    'code/x-ssh-config',
    '.ssh',
    ['config']
  ),
  holds('a project with a .aws and no login in it is given', false, 'code/x-aws-no-login', '.aws', [
    'login.json'
  ]),
  holds('a project with a .ssh holding only id_rsa.pub is given', false, 'code/x-ssh-pub', '.ssh', [
    'id_rsa.pub'
  ]),
  holds(
    'a project with a .aws holding only a config is given',
    false,
    'code/x-aws-config',
    '.aws',
    ['config']
  ),
  holds('a project with .docker/Dockerfile is given', false, 'code/x-docker', '.docker', [
    'Dockerfile'
  ]),
  holds('a project with .kube/overlay.yaml is given', false, 'code/x-kube-own', '.kube', [
    'overlay.yaml'
  ]),
  holds('a project with .config/dotnet-tools.json is given', false, 'code/x-config', '.config', [
    'dotnet-tools.json'
  ]),
  holds('a project with .claude/settings.json is given', false, 'code/x-claude', '.claude', [
    'settings.json'
  ]),
  is('Documents is given', false, 'Documents', []),

  // The stated limit: a store two levels down is not looked at.
  {
    state: 'a folder with a .ssh and a key two levels below is given',
    refused: false,
    make: (at) => {
      folderWith(at, 'Documents/old-mac/.ssh', ['id_ed25519']);
      return join(at, 'Documents');
    }
  },

  // Links, by real path. A store's own name counts, another name does not.
  {
    state: "a link to the home's .docker, itself, is refused",
    refused: true,
    make: (at, home) => {
      const target = ownStore(home, '.docker', ['config.json']);
      const link = join(folderWith(at, 'links-self'), 'to-docker');
      symlinkSync(target, link);
      return link;
    }
  },
  {
    state: "a folder holding a link named .docker to the home's .docker is refused",
    refused: true,
    make: (at, home) => {
      const target = ownStore(home, '.docker', ['config.json']);
      const holder = folderWith(at, 'links-named');
      symlinkSync(target, join(holder, '.docker'));
      return holder;
    }
  },
  {
    state: "a folder holding a link under another name to the home's .ssh with a key is given",
    refused: false,
    make: (at, home) => {
      const target = ownStore(home, '.ssh', ['id_ed25519']);
      const holder = folderWith(at, 'links-other');
      symlinkSync(target, join(holder, 'creds'));
      return holder;
    }
  },
  {
    state: 'a folder holding a link under another name to a marked .docker is given',
    refused: false,
    make: (at) => {
      const target = folderWith(at, 'links-marked-target/.docker', ['config.json']);
      const holder = folderWith(at, 'links-marked');
      symlinkSync(target, join(holder, 'stuff'));
      return holder;
    }
  },

  // Case variants, on a disk that ignores case. A mark inside is what counts.
  {
    ...is('a .Docker with config.json is refused', true, 'case-docker/.Docker', ['config.json']),
    macDisk: true
  },
  {
    ...holds(
      'a folder holding a .Docker with config.json is refused',
      true,
      'case-docker-holder',
      '.Docker',
      ['config.json']
    ),
    macDisk: true
  },
  { ...is('a .KUBE with CONFIG is refused', true, 'case-kube/.KUBE', ['CONFIG']), macDisk: true },
  {
    ...holds('a folder holding a .KUBE with CONFIG is refused', true, 'case-kube-holder', '.KUBE', [
      'CONFIG'
    ]),
    macDisk: true
  },
  { ...is('a .SSH with a key is refused', true, 'case-ssh/.SSH', ['id_ed25519']), macDisk: true },
  { ...is('a bare .SSH is given', false, 'case-bare/.SSH', []), macDisk: true },
  {
    ...holds('a folder holding a bare .SSH is given', false, 'case-bare-holder', '.SSH', []),
    macDisk: true
  },

  // The home's own stores stay refused by name, with no mark in them.
  ...['.ssh', '.aws', '.gnupg', '.docker', '.kube'].map((store): StoreState => ({
    state: `the home's own ${store} is refused by name, with no mark in it`,
    refused: true,
    homeOnly: true,
    make: (_at, home) => folderWith(home, store)
  }))
];

// One file each, so a list that loses one fails. Written out, since these
// lists are what the ruling set; `sso/` and the like are made as folders.
const STORE_FILES: Record<string, string[]> = {
  '.ssh': [
    'id_rsa',
    'id_ecdsa',
    'id_ecdsa_sk',
    'id_ed25519',
    'id_ed25519_sk',
    'id_dsa',
    'authorized_keys',
    'known_hosts'
  ],
  '.aws': ['credentials', 'sso/', 'cli/cache/', 'login/'],
  '.gnupg': ['private-keys-v1.d/', 'secring.gpg', 'pubring.kbx'],
  '.docker': ['config.json'],
  '.kube': ['config'],
  '.config': ['gcloud/', 'gh/hosts.yml'],
  Library: ['Keychains/login.keychain-db', 'Cookies/'],
  AppData: ['Roaming/', 'Local/'],
  '.claude': ['.credentials.json', 'history.jsonl', 'projects/'],
  '.codex': ['auth.json', 'sessions/'],
  '.grok': ['auth.json', 'sessions/'],
  '.gemini': ['oauth_creds.json', 'google_accounts.json']
};

/** Every file that makes a folder the real store: the folder, and one directly holding it. */
export const MARK_STATES: StoreState[] = Object.entries(STORE_FILES).flatMap(([store, files]) =>
  files.flatMap((file): StoreState[] => {
    const named = `${store}-${file.replace(/\W/g, '-')}`;
    return [
      is(`a ${store} with ${file} is refused`, true, `marks/${named}/${store}`, [file]),
      holds(
        `a folder holding a ${store} with ${file} is refused`,
        true,
        `holders/${named}`,
        store,
        [file]
      )
    ];
  })
);

/**
 * Why a test of the folder check skips on real Windows: the temp folder every
 * test builds in sits in the real home's AppData, a secret store, so the check
 * refuses all of it, and `HOME` cannot move the home there. Read once, before
 * any faked platform.
 */
export const TEMP_IN_APPDATA =
  process.platform === 'win32' && "Windows' temp folder sits in the home's AppData";

/** Whether this disk can tell case variants apart: a Mac's cannot. Read once, before any faked platform. */
const CASE_FOLDS_HERE = process.platform === 'darwin';

/** Whether `s` can be built on this disk, so a run off a Mac leaves out the case variants. */
export const onThisDisk = (s: StoreState): boolean => !s.macDisk || CASE_FOLDS_HERE;
