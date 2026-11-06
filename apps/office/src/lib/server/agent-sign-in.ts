// How the owner installs the office's Grok, Codex and Gemini, signs Grok and
// Codex in, and gives Gemini its API key, from the office's page
// (routes/api/agents/[tool]), so no tool an Odd runs on needs Terminal.
// Claude Code's install and sign-in are Setup's Claude card.
//
// Install runs the tool's own installer and sign-in its own sign-in command
// in the office's home for it, each streamed to the page through the runner
// Claude Code's uses (command-stream.ts), one at a time per tool. An install
// runs to its end, since one stopped halfway can leave the tool half
// installed or a shell's settings half written. Sign out removes that home's
// sign-in file and nothing else: it never runs a tool's own logout, since
// `GROK_HOME=<office> grok logout` removed the owner's own ~/.grok sign-in in
// the same second. The session at xAI or OpenAI lasts until it ends or the
// owner removes it in their account. Server only.
import { rmSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Agent } from '@oddboro/ledger';
import { claudeCommand } from '@oddboro/ledger/platform';
import { codexAccount, codexSignIn, CODEX_AUTH } from './codex.ts';
import { commandSlot, type Slot } from './command-stream.ts';
import { clearGeminiKey, geminiAccount, setGeminiKey } from './gemini.ts';
import { grokAccount, grokCommand, grokSignIn, GROK_AUTH } from './grok.ts';
import { vendorEnv } from './launch.ts';
import { onPath } from './on-path.ts';

/** Every tool the owner signs in to from here: each but Claude Code. */
export type SignInTool = Exclude<Agent, 'claude'>;

type Account = { email?: string };
/** A command and its arguments, as spawn takes them. */
type Command = readonly [string, readonly string[]];
/** A tool that signs in on its maker's page in the browser, and keeps the sign-in as a file. */
type BrowserSignIn = {
  how: 'browser';
  /** The tool's own installer, which the page's Install runs. */
  install: Command;
  /** The office home's sign-in file, which Sign out removes. */
  auth: string;
  account: () => Account | undefined;
  command: () => { args: string[]; env: NodeJS.ProcessEnv };
};
/** A tool that signs in with an API key the owner pastes. */
type KeySignIn = {
  how: 'key';
  install: Command;
  account: () => Account | undefined;
  setKey: (key: string) => Promise<{ ok: true } | { ok: false; problem: string }>;
  clear: () => void;
};

/** How the owner signs each tool in from the page. Every tool has an entry, so a new one fails the type check until it does. */
export const SIGN_INS: Record<SignInTool, BrowserSignIn | KeySignIn> = {
  grok: {
    how: 'browser',
    // Grok installs only through xAI's own script: its usage line, run as it says.
    install: ['bash', ['-c', 'curl -fsSL https://x.ai/cli/install.sh | bash']],
    auth: GROK_AUTH,
    account: grokAccount,
    command: grokSignIn
  },
  codex: {
    how: 'browser',
    install: ['npm', ['install', '-g', '@openai/codex']],
    auth: CODEX_AUTH,
    account: codexAccount,
    command: codexSignIn
  },
  gemini: {
    how: 'key',
    install: ['npm', ['install', '-g', '@google/gemini-cli']],
    account: geminiAccount,
    setKey: setGeminiKey,
    clear: clearGeminiKey
  }
};

/** One install or sign-in at a time per tool. */
export const SLOTS: Record<SignInTool, Slot> = {
  grok: commandSlot(),
  codex: commandSlot(),
  gemini: commandSlot()
};

/** What the page reads about one tool's sign-in (in `/api/agents`). */
export type SignInState = {
  how: 'browser' | 'key';
  /** Its install runs, so the page offers nothing else for it until that ends, even after a refresh. */
  installing: boolean;
  signedIn: boolean;
  /** The account's email, when the sign-in names one. */
  account?: string;
  /** A sign-in waits on its page, with that page's address once printed. */
  waiting?: { url?: string };
};

export function signInState(tool: SignInTool): SignInState {
  const s = SIGN_INS[tool];
  const account = s.account();
  const running = SLOTS[tool].running;
  return {
    how: s.how,
    installing: running?.action === 'install',
    signedIn: !!account,
    ...(account?.email ? { account: account.email } : {}),
    ...(running?.action === 'sign-in' ? { waiting: running.url ? { url: running.url } : {} } : {})
  };
}

/** Sign out: remove the office home's sign-in file, or Gemini's key. Never a tool's own logout. */
export function signOut(tool: SignInTool): void {
  const s = SIGN_INS[tool];
  if (s.how === 'browser') rmSync(s.auth, { force: true });
  else s.clear();
}

/**
 * How a tool starts: the program, then any words before the tool's own. A
 * run, a sign-in and the page's "installed" all use it. Claude Code's comes
 * from `claudeCommand`, which on Windows also finds an npm install's
 * claude.cmd and runs its script under this Node; Grok's from `grokCommand`,
 * which also looks in xAI's install folder; every other tool's from PATH.
 * Undefined when it is not installed.
 */
export function agentCommand(tool: Agent): Command | undefined {
  if (tool === 'grok') {
    const grok = grokCommand();
    return grok ? [grok, []] : undefined;
  }
  if (tool === 'claude') {
    const [cmd, before] = claudeCommand();
    // A path when Windows found it; the bare name everywhere else, which PATH finds.
    if (isAbsolute(cmd)) return [cmd, before];
  }
  const found = onPath(tool);
  return found ? [found, []] : undefined;
}

/**
 * What the page calls this computer: Mac on a Mac, computer elsewhere, as the
 * page's header has it (`computer` in +page.server.ts). Read per call, since
 * MAC is fixed at import and a test stubs the system.
 */
export const computerWord = (): 'Mac' | 'computer' =>
  process.platform === 'darwin' ? 'Mac' : 'computer';

/**
 * The environment an installer gets: the office's, with no key of its own and
 * no Grok or xAI setting, since `GROK_BIN_DIR` would put Grok's links outside
 * the folder `grokCommand` looks in, and `GROK_DEPLOYMENT_KEY` would make
 * xAI's installer fetch the enterprise build.
 */
export const installEnv = (): NodeJS.ProcessEnv => vendorEnv(['GROK_', 'XAI_']);
