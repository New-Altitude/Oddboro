// No secret and no one's home folder reaches a tracked file: no private key,
// no API token in a known shape, no key or certificate file, no .env, and no
// /Users/<name>, /home/<name> or C:\Users\<name> path, which names whoever
// wrote it. Unlike check-private, it needs no list, so it runs the same on any
// computer and in CI.
import { read, repoFiles, report } from './lib/files.ts';

/** Files that hold a secret by their kind alone. */
const SECRET_FILE =
  /(^|\/)(\.env(?!\.example$)[^/]*|[^/]+\.(p8|p12|pfx|pem|key|keychain|keychain-db|mobileprovision))$/i;

/** Secrets in a shape a provider publishes, or a private key's header. */
const SECRETS: [string, RegExp][] = [
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // Built from parts, so this file never holds the header it looks for.
  [
    'an updater signing key',
    new RegExp(['untrusted comment: rsign', 'encrypted secret key'].join(' '))
  ],
  ['an Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI key', /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ['a GitHub token', /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['an AWS key', /AKIA[0-9A-Z]{16}/],
  ['a Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['a Slack token', /xox[abprs]-[A-Za-z0-9-]{20,}/],
  ['a Stripe key', /(sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['an Apify token', /apify_api_[A-Za-z0-9]{20,}/]
];

/** A home folder, except the shared one and CI's. */
const HOME = /\/(Users|home)\/(?!Shared\/|runner\/)[A-Za-z0-9._-]+\//;
/** A Windows home folder, its backslashes single or escaped, except the shared ones and CI's. */
const WINDOWS_HOME =
  /[A-Za-z]:(\\\\?|\/)Users(\\\\?|\/)(?!(Public|Default|runneradmin)(\\|\/))[A-Za-z0-9._-]+(\\|\/)/i;

const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|mp4|m4a|mp3|zip|dmg)$/i;
const failures: string[] = [];
for (const file of repoFiles()) {
  if (SECRET_FILE.test(file)) failures.push(`${file}: a key, certificate or .env file`);
  if (BINARY.test(file) || file === 'package-lock.json') continue;
  read(file)
    .split('\n')
    .forEach((line, i) => {
      for (const [what, re] of SECRETS)
        if (re.test(line)) failures.push(`${file}:${i + 1} holds what looks like ${what}`);
      if (HOME.test(line) || WINDOWS_HOME.test(line))
        failures.push(`${file}:${i + 1} names a home folder`);
    });
}
report('secrets', failures);
