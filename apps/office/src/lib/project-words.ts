// What the owner reads about a project's Claude Code conversations, each line
// once. The page and the server both read it, so it imports nothing: a server
// module here would break the page's build.
export const PROJECT_WORDS = {
  update: 'Update Claude Code to use Projects: run claude update',
  backgroundOff:
    'Projects needs Claude Code’s background sessions, and they are turned off on this computer. Ask whoever manages Claude Code here to turn them on.',
  trustLine:
    'Claude Code asks once before it works in a new folder. Answer its question there, and the session starts.',
  notTrusted:
    'Claude Code was not told to trust this folder, so nothing started. Choose Start to be asked again.',
  inTerminal: 'Running in a terminal',
  moveButton: 'Move here',
  moveConfirm:
    'This closes the conversation in its terminal and opens it here. The conversation is kept. To keep using it in that terminal too, run the command it shows there.',
  moveCancel: 'Cancel',
  busy: 'Claude is still working in that terminal. Try again when it finishes.',
  windows:
    'This conversation is open in a terminal. In that terminal, type /exit, then select it here again.',
  useMove: 'This conversation is open in a terminal. Choose Move here to bring it in.',
  copied: 'This conversation just opened in another window. Try again.',
  startFailed: 'Claude Code could not start this conversation. Try again.',
  closeSlow: 'That terminal is still closing. Wait a moment, then try again.',
  switched:
    'That terminal is no longer showing this conversation, so nothing was closed. Try again.',
  waiting: 'Claude is waiting for your answer in that terminal. Answer it there, then try again.',
  stopButton: 'Stop',
  stopConfirm: 'This ends the session for every window joined to it. The conversation is kept.',
  // Starts with the button's visible word, so voice control finds it by what it shows.
  stopName: 'Stop: end this session for every window',
  stopFailed: 'Claude Code could not stop this session. Try again.',
  stopBusy: 'Finish or stop the active work before you stop the session.',
  stopping: 'This session is being stopped. Try again in a moment.',
  // Remove's confirm reads removeAsk, then removeEnds for a Claude session only, then removeDetail.
  removeAsk: 'Remove this session from Projects?',
  removeEnds: 'This ends the session for every window still joined to it.',
  removeDetail:
    'Work still waiting for it stops, and no Odd can send it more work. The conversation itself is kept: connect it again to bring the session back, then share it again with any Odd that should have it.',
  focus: 'Focus',
  // Starts with the button's visible word, so voice control finds it by what it shows.
  focusName: 'Focus: fill the window with the terminal',
  looking: 'Looking for conversations.'
} as const;
