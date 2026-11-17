// What the owner reads about a project's Claude Code conversations, each line
// once. The page and the server both read it, so it imports nothing: a server
// module here would break the page's build.
export const PROJECT_WORDS = {
  update: 'Update Claude Code to use Projects: run claude update',
  backgroundOff:
    'Projects needs Claude Code’s background sessions, and they are turned off on this computer. Ask whoever manages Claude Code here to turn them on.',
  trustLine:
    'Claude Code asks once before it works in a new folder. Answer its question, then choose Start again.',
  startAgain: 'Start again',
  inTerminal: 'Running in a terminal',
  moveButton: 'Move here',
  moveConfirm:
    'This closes the conversation in its terminal and opens it here. The conversation is kept. To keep using it in that terminal too, run the command it shows there.',
  moveCancel: 'Cancel',
  busy: 'Claude is replying in that terminal. Try again when it finishes.',
  windows:
    'This conversation is open in a terminal. In that terminal, type /exit, then select it here again.',
  useMove: 'This conversation is open in a terminal. Choose Move here to bring it in.',
  copied: 'This conversation just opened in another window. Try again.',
  startFailed: 'Claude Code could not start this conversation. Try again.',
  closeSlow: 'That terminal is still closing. Wait a moment, then try again.',
  switched: 'That terminal has switched to another conversation, so nothing was closed. Try again.',
  waiting: 'Claude is waiting for your answer in that terminal. Answer it there, then try again.',
  focus: 'Focus',
  // Starts with the button's visible word, so voice control finds it by what it shows.
  focusName: 'Focus: fill the window with the terminal',
  looking: 'Looking for conversations.'
} as const;
