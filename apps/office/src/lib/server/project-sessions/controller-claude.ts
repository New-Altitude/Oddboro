// The Claude half of connect: the Claude folder a session runs in, and which
// copy of a conversation connect opens, checked before anything is stored or
// started. Server only.
import {
  claudeConfigDir,
  claudeFolderFound,
  defaultClaudeFolder,
  isClaudeFolder,
  type ProjectSession
} from '@oddboro/ledger';
import { canMoveHere, nativeEnv, UUID } from './native.ts';
import {
  claudeAgents,
  claudeProjects,
  claudeProjectsIn,
  inTerminal,
  type ClaudeConversation
} from './claude-project.ts';
import { endTerminalSession, stopInBackground, type ClaudeWhere } from './claude-background.ts';
import { PROJECT_WORDS } from '../../project-words.ts';
import { claudeFolderMark } from '../claude.ts';

/**
 * What connect tells the owner about a Claude session's folder, by folder
 * marks (`claudeFolderMark`): `newer` and `to` name the folder holding the
 * conversation's newest copy, `from` the one the session left, and `terminal`
 * the folder of the terminal session connect's `move` ended. A session moves only
 * when its own folder lacks the conversation, or to that terminal's folder,
 * so at most one applies.
 */
export const FOLDER_NOTICE = {
  newer: (mark: string) =>
    `A newer copy of this conversation is in ${mark}. To switch to it, choose it under Continue an earlier one.`,
  moved: ({ from, to }: { from: string; to: string }) =>
    `This conversation is no longer in ${from}, so the session moved to ${to}, which has its newest copy.`,
  terminal: (mark: string) => `The terminal was using ${mark}, so this session now uses it too.`
};

/**
 * Connect's refusal of a Claude folder picked in the continue path's list that no longer
 * holds the conversation, by that folder's mark: a stale list, since the copy
 * moved or went after the list was read.
 */
export const PICK_LACKS_IT = (mark: string) =>
  `That conversation is no longer in ${mark}. Choose Refresh list to see where it is now.`;

/**
 * `dir`, when the office may run Claude Code in it: a folder in Setup, and, for
 * a named one, on the disk now. Checked before any `claude` command, since
 * `claude agents`, `claude auth status` or `claude --bg` write into the folder
 * they run in, and could create it.
 */
export function runnableClaudeFolder(dir: string): string {
  if (!isClaudeFolder(dir)) throw new Error('That Claude folder is not in Setup.');
  return foundClaudeFolder(dir);
}

/** `dir`, unless it is a folder other than `~/.claude` that is not on the disk now. */
function foundClaudeFolder(dir: string): string {
  if (claudeConfigDir(dir) !== undefined && !claudeFolderFound(dir))
    throw new Error('That Claude folder is not found.');
  return dir;
}

/**
 * The Claude folder the office's own `claude` would use: the one the office's
 * `CLAUDE_CONFIG_DIR` names, else `~/.claude`. Read at each call, as the native
 * client reads it. Being the office's folder does not make it known: the
 * Account list and the Odds' deny lists hold only known folders, and Setup
 * suggests it only when it is an account folder at the top of the home folder,
 * as it suggests any such folder.
 */
const officeClaudeFolder = () => nativeEnv().CLAUDE_CONFIG_DIR || defaultClaudeFolder();

/**
 * The Claude folder a session runs in: its own, checked and never replaced, or
 * the office's default folder while it has none, as before sessions kept one.
 * Connect is the one place a folder is found and stored, so nothing here
 * stores one.
 */
export const sessionFolder = (s: ProjectSession) =>
  s.configDir === null
    ? foundClaudeFolder(officeClaudeFolder())
    : runnableClaudeFolder(s.configDir);

/**
 * The refusal of a Claude conversation open in a terminal: where `move`
 * works, the owner can choose it; elsewhere, the steps to end it there.
 */
export const openInTerminal = () =>
  new Error(canMoveHere() ? PROJECT_WORDS.useMove : PROJECT_WORDS.windows);

/**
 * The conversation id of the background session `short`, just started in
 * `where`, once `claude agents` lists it. A new
 * session was measured to list within half a second. One not listed in 5 s is
 * stopped, and Start fails.
 */
export async function startedSession(where: ClaudeWhere, short: string): Promise<string> {
  const end = performance.now() + 5000;
  let failed: unknown;
  for (;;) {
    // A read that fails counts as not listed yet: the session may still be
    // starting, and the 5 s limit ends the wait either way. The last failure
    // is logged if it never lists.
    const rows = await claudeAgents(where.folder, where.dir).catch((e: unknown) => {
      failed = e;
      return [];
    });
    const id = rows.find((a) => a.id === short)?.sessionId;
    if (id && UUID.test(id)) return id;
    if (performance.now() > end) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(
    `claude agents never listed the session ${short} it started:`,
    failed ?? 'not listed'
  );
  await stopInBackground(where, short);
  throw new Error(PROJECT_WORDS.startFailed);
}

/**
 * Which copy of the saved Claude conversation `id` of the project `folder`
 * connect opens, in which Claude folder, and what to tell the owner about it.
 * `known` is the session already connected to it, if any; `configDir` the
 * folder the page sent; `move` the owner's yes to end its terminal session.
 */
export async function copyToOpen(
  folder: string,
  id: string,
  options: { known?: ProjectSession; configDir?: string; move: boolean }
): Promise<{ saved?: ClaudeConversation; configDir?: string; folderNotice: string | null }> {
  const { known, move } = options;
  let { configDir } = options;
  let folderNotice: string | null = null;
  // Reconnect sends the session's stored folder back, so that folder is no
  // pick, and one that lost the conversation still moves below. Connect
  // checks it as sent, so a stored folder out of Setup is still refused.
  if (configDir === known?.configDir) configDir = undefined;
  // The folder a known session resumes in: the one picked in the
  // continue path's list, which moves it there, else its own (`sessionFolder`).
  const ownDir = known && (configDir ?? sessionFolder(known));
  const find = (rows: ClaudeConversation[]) => rows.find((row) => row.id === id);
  const [own, newest, newIdPick] = await Promise.all([
    ownDir ? claudeProjectsIn(folder, ownDir).then(find) : undefined,
    claudeProjects(folder).then(find),
    // A new id's pick is looked up only for the refusal below, so it
    // never gets a notice; a known session's pick is its `ownDir`.
    !known && configDir !== undefined ? claudeProjectsIn(folder, configDir).then(find) : undefined
  ]);
  // A pick that lacks a conversation some folder holds is a stale list.
  // Refused before anything is stored or spawned, so no terminal starts
  // that id afresh while a copy of it exists.
  if (configDir !== undefined && !(known ? own : newIdPick) && newest)
    throw new Error(PICK_LACKS_IT(await claudeFolderMark(configDir, { fresh: true })));
  // Only a session whose own folder lacks the conversation takes the
  // folder holding its newest copy, so one connected before its folder
  // was known gets it now, and one with no folder found in the office's
  // default folder keeps none. Reconnect moves a session to another
  // folder only then, or to the folder of a terminal `move` ends (below),
  // and tells the owner.
  const movedTo = known && !own && configDir === undefined ? newest?.configDir : undefined;
  if (!own) configDir ??= newest?.configDir ?? undefined;
  let saved = own ?? newest;
  // Resuming a copy beside one open in a Claude terminal, in any folder,
  // would fork the conversation. With the owner's yes, that terminal
  // session ends first: the process this read found, while a second read
  // still finds it idle.
  const open = [own, newest].find(inTerminal);
  // The Claude folder of the terminal session `move` ended, when it is
  // not the one this session would resume in. The owner was using that copy,
  // so the session resumes and is stored there, as a pick of it would be,
  // never in an older copy here.
  let terminalDir: string | undefined;
  if (open) {
    if (!move) throw openInTerminal();
    await endTerminalSession(folder, open);
    if (open.configDir !== null && open.configDir !== (configDir ?? ownDir)) {
      terminalDir = configDir = open.configDir;
      saved = open;
    }
  }
  // Told after that refusal, so a refused Reconnect reads no folder's
  // login. A copy running in two folders has no folder to name.
  if (terminalDir)
    folderNotice = FOLDER_NOTICE.terminal(await claudeFolderMark(terminalDir, { fresh: true }));
  else if (movedTo && ownDir) {
    const [from, to] = await Promise.all(
      [ownDir, movedTo].map((dir) => claudeFolderMark(dir, { fresh: true }))
    );
    folderNotice = FOLDER_NOTICE.moved({ from, to });
  }
  // A session with its own copy still opens it, so the owner never
  // lands in an older one without being told.
  else if (own && newest?.configDir && newest.configDir !== ownDir && newest.updated > own.updated)
    folderNotice = FOLDER_NOTICE.newer(await claudeFolderMark(newest.configDir, { fresh: true }));
  return { saved, configDir, folderNotice };
}
