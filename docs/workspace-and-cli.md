# Office, Workspace and the command line

On a fresh office, choose **Office** for the floor or **Workspace** for a list of Odds, conversations, decisions, and results. Existing offices open on the floor unless you have chosen Workspace. **Open Office** and **Workspace** switch views. Each browser remembers its choice. Both views use the same running office.

In Workspace, **Needs you** shows open decisions. Choose a row to read the request and answer it. Choose an Odd to read its chat, send an assignment or steer an active reply. Use Alt+Down and Alt+Up to switch. Turn on Advanced in Settings to include native Codex and Claude project sessions. Select a session to inspect it; explicitly take terminal control to type. Closing a window or a terminal leaves the office running. **Stop office** ends the service, including running work.

## Agent HUD

Choose **Agent HUD** in Workspace. **Who needs me?** lists Claude Code and Codex requests for input or approval, decisions on your desk, owner tasks and proposed project work. Choose a row's action to answer in its own chat, project or desk. **Ready to review** holds unread Codex replies, messages from Odds and reports. **In progress** lists active jobs and open Codex turns. Ask your Office Manager to help pick what to do first. You can edit the message before sending it.

The HUD checks Claude Code's local agent list, including blocked background jobs. For Codex it checks connected projects and the existing local App Server daemon when available. For a separate desktop or terminal server, the HUD checks the last recorded turn of each detected open chat. Open that chat to see any private prompts. The local Codex unread index can still show replies. The panel tells you when it cannot read a source. Office work updates as it changes. Returning to the HUD or choosing **Refresh** checks external agents and takes a new computer sample.

Computer activity lists Claude Code, Codex, Gemini and Grok processes under the owner's account. Sort by CPU or memory. 100% CPU uses one core. Memory sums resident pages in a process tree and can include shared pages. A shared server has one reading. On Mac and Linux, expand its open Codex conversations to see names when available. Windows shows process totals. **Ask about this run** prepares a message about the selected process.

## Pair a client with your office

Save the owner pairing code in your password manager when the app first opens. Starting from a terminal prints the code there. The desktop asks for it when it reconnects. The CLI takes it at a hidden prompt or from standard input for scripts. Keep the code out of command arguments, environment variables, and shell history.

The office stores a signed, encrypted client session in its home directory. Only the owner pairing code opens it. Each server process has a fresh session. An open credential store lets the owner reuse the same pairing code after a restart. Without a credential store, the office prints a new code at startup and cannot register unattended startup at login.

## Run without a display

Use the executable inside the installed app. On a Mac, run `/Applications/Oddboro.app/Contents/MacOS/oddboro`. On Linux run your Oddboro AppImage. On Windows use the installed executable in PowerShell and pipe to `Out-Host` for interactive output from the windowed executable. The commands below use `oddboro` as shorthand for that path. The packaged CLI does not need a separate Node install.

```sh
oddboro start
oddboro tools
oddboro sign-in claude
oddboro setup Sam America/Los_Angeles marshall claude
oddboro hire River Analyst 'Review the two proposals'
oddboro odds --json
oddboro assign river 'Compare the two proposals'
oddboro chat river
oddboro inbox
oddboro open workspace
```

Use the ID printed by `odds`. An assignment returns its turn and run IDs when the office accepts it. For a safe retry, pass the same message and `--turn UUID`. Use `follow ODD` for new chat entries, `steer ODD RUN MESSAGE` or `stop-run ODD RUN` to target a specific reply. Read a request with `inspect ID`, then use `approve ID` or `decline ID`. Opening a project folder or granting access may require completing the corresponding Desk action. Inspect a report with `report ID` or read a delivered text file with `file ODD PATH`. See `help` for the full command list. Commands exit nonzero on failure; `--json` prints machine-readable results. Provider sign-in may require a browser on another device. A locked credential store must be unlocked by its owner.

For native sessions, use `advanced on --accept-project-access`, then `projects`. Use `project find '{"agent":"codex","folder":"/path/to/project"}'` and `project connect` with that folder and the native ID. `terminal SESSION` takes input after the office authorizes the view. Press Ctrl+] to detach.

## Start, update and recover

`start` reuses the running office. `--headless` runs its supervisor in the foreground. `stop` asks the supervisor to stop and waits for it. `login on`, `login off`, and `login status` manage the packaged background launcher. It is separate from the desktop preference to open a window at login. The packaged launcher uses the source service's registration name; stop the old source office before replacing its launcher. Keep its home directory and credentials. If the office or port does not match, the app refuses to attach. Stop the old version with its own command before starting the new one.

The packaged service uses the same database upgrade and backup path as the desktop office. The service checks the release manifest, verifies the signed version and download, and waits for the office's update window. It restarts headlessly when an update is ready. An installation that requires administrator access reports the issue in the office log; use the signed platform installer in that case. On Mac and Linux, the service retains the previous installation until the new version answers. Confirm the version with `status`. After an interrupted upgrade, inspect the office log before retrying work.

The Mac log is in `~/Library/Logs/Oddboro/office.log`, the Linux log in `~/.local/state/oddboro/office.log` (or the XDG state directory), and the Windows log in `%LOCALAPPDATA%\Oddboro\Logs\office.log`. To remove the background installation, turn off its login entry, stop the office, and uninstall the app normally. Keep the office home if you want to keep its history.
