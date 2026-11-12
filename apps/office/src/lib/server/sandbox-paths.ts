// The system's own paths each tool's sandbox names, per system. Only the
// Mac's are measured, and Grok's shut list on Linux. Linux and Windows carry
// the Mac's other values because those are what the office passes there; they are not measured, and some are Mac
// paths that mean nothing there. Correcting them is its own change, measured
// on that system. A run on a system with no entry stops at `sandboxPaths()`.
import { currentPlatform } from '@oddboro/ledger/platform';

export type SandboxPaths = {
  /** Where a run's commands get a temp folder of their own. */
  tmpRoot: string;
  /** Every home folder, every other disk and the shared temp folders: shut to Claude Code's commands. */
  denyReadRoots: readonly string[];
  /** What Grok's `strict` profile reads besides the run's folder and Grok's home. */
  strictReads: readonly string[];
  /** What Grok's profile shuts again inside `strictReads`, where they exist. */
  grokShut: readonly string[];
  /** Apple's developer tools, which the shims in /usr/bin run through: read by Codex's profile. */
  codexReads: readonly string[];
  /** The OpenSSL config node reads as it starts: read by Codex's profile. */
  opensslConf: string;
};

const MAC: SandboxPaths = {
  // Spelt /private/tmp, since /tmp broke every command (measured).
  tmpRoot: '/private/tmp',
  denyReadRoots: ['/Users', '/Volumes', '/private/tmp', '/tmp', '/private/var/folders'],
  // As Grok 1.0.46 on macOS logged it (ProfileApplied in its sessions'
  // sandbox-events.jsonl).
  strictReads: [
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/dev',
    '/System',
    '/Library',
    '/private',
    '/tmp',
    '/var'
  ],
  grokShut: ['/Library', '/tmp', '/var'],
  // The folder xcode-select uses by default, and the link it reads when the
  // owner switched it elsewhere; /var is itself a link.
  codexReads: ['/Library/Developer/CommandLineTools', '/private/var/db/xcode_select_link'],
  // Fits node from nodejs.org and from nvm (measured on node 24.22.2).
  opensslConf: '/System/Library/OpenSSL/openssl.cnf'
};

export const SANDBOX_PATHS: Partial<Record<NodeJS.Platform, SandboxPaths>> = {
  darwin: MAC,
  // Measured on Ubuntu 26.04 with Grok 1.0.77: Grok refuses a deny glob that
  // matches over 4096 files, which /var/** does on any real machine, and an
  // exact-path deny of /tmp or /var stops it starting. So Grok's profile
  // leaves both open on Linux, and the office's file tools are the wall there.
  linux: { ...MAC, grokShut: ['/Library'] },
  win32: MAC
};

/** This system's sandbox paths. A run that sandboxes where none are declared stops here. */
export function sandboxPaths(): SandboxPaths {
  const platform = currentPlatform();
  const paths = SANDBOX_PATHS[platform];
  if (!paths) throw new Error(`No sandbox paths are declared for ${platform}.`);
  return paths;
}
