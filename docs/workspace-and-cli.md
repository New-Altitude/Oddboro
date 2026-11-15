# Office, Workspace and the command line

On a fresh office, choose **Office** for the floor or **Workspace** for a list of Odds, conversations, decisions, and results. Existing offices open on the floor unless you have chosen Workspace. **Open Office** and **Workspace** switch views. Each browser remembers its choice. Both views use the same running office.

In Workspace, **Needs you** shows open decisions. Choose a row to read the request and answer it. Choose an Odd to read its chat, send an assignment or steer an active reply. Use Alt+Down and Alt+Up to switch. Turn on Advanced in Settings to include native Codex and Claude project sessions. Select a session to inspect it; explicitly take terminal control to type. Closing a window or a terminal leaves the office running. **Stop office** ends the service, including running work.

## Agent HUD

Choose **Agent HUD** on the floor or in Workspace. In Workspace, **Alt+H** also opens it. Close the HUD to return to where you opened it. Opening it does not require Advanced mode.

Expand an agent to see the work behind its counts. The HUD shows the share left in each reported weekly and five-hour window, with its reset time. Claude uses the last windows the office received from Claude Code. Codex reads the signed-in account’s limits from its local App Server. If there is no shared daemon, an account-only client reads the limits and exits. A missing or expired window shows **Unavailable**. Odds use their linked provider plans.

Choose a decision to see who is waiting and why. For desk asks, the HUD also shows what approval would do. **Review decision** opens the original Desk card with its choices and any required checks. Returning to the list after answering takes you back to the queue. Native project decisions open in Projects or the owning tool. **Ask your Office Manager** prepares an editable message about the waiting work.

The arrow keys select a decision. Enter moves to its action. Tab moves between controls. Escape returns from the action to the queue, then closes the HUD. Under **Keyboard shortcuts**, choose an action and press new keys, turn its shortcut off, or restore the defaults. Workspace remembers bindings in this browser. Its HUD shortcut leaves typing and terminal input alone.

Office work updates when it changes. Opening the HUD, returning to the window or choosing **Refresh** checks external sources. Claude reports questions and blocked jobs through its agent list. Codex exposes live requests for connected projects and its local daemon. A separate desktop or terminal chat may show only an open turn. Open that chat to check its prompt.

In the desktop **Office strip**, a resource warning opens the process list sorted by CPU or memory. Below it, each pending decision links to its own ask, project request, or agent conversation. A standalone chat that reports only a waiting flag appears as a chat needing input. Only identified requests contribute to the decision count. **Waiting** still opens the whole Desk. Press **Esc** to return to the strip. The main window keeps your chat draft and returns to its previous visibility. An external Claude terminal or Codex app owns its own keyboard shortcuts after you switch to it.

**Ready to review** holds unread replies and reports. Expand **Computer activity** for CPU, memory and processes under the owner’s account. 100% run CPU uses one core. Each process includes child memory and can include shared pages. On Mac and Linux, a shared server can list its open Codex conversations. Windows shows process totals.

While the office is running, your Office Manager checks the computer every 15 seconds, even with the HUD closed. Two consecutive CPU intervals at 90% or higher, or two memory-pressure readings, trigger a recommendation on the floor, in Workspace and in the HUD. The manager also sends one desktop notification per episode through Oddboro’s regular notification service. System notification settings determine whether it appears.

The manager checks the leading agent process for the resource under pressure and suggests what to review. **Review agent processes** opens the HUD sorted by that resource. A shared server gets one reading across its chats. Expand a Codex process to open one of its identified chats in Codex. If agents account for little usage or the process list is unavailable, the manager points you to the system monitor. You choose whether to pause or close any work in its own app. During a long episode the manager rechecks the leading process about once a minute. The recommendation clears after two checks without confirmed pressure.

On Mac the memory signal comes from the kernel’s warning or critical level. On Linux the manager checks whether tasks have been stalled for memory at least 10% of the past ten seconds. On Windows it checks for less than both 5% of physical memory and 512 MiB available. The detailed process scan runs when pressure is confirmed or you open or refresh the HUD.

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
