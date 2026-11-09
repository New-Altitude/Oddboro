# Work in a native project session

Open **Projects** on the office floor or **Project sessions** in an Odd's chat. The office opens the Codex or Claude Code installed on this computer. The native client reads its usual account, project instructions, skills, hooks and tool settings. A worktree is a separate project. The session window identifies the project by its full path and the conversation by its native ID.

## Start or connect

1. Choose the project folder and coding tool. Select **Start new** to open a fresh conversation.
2. To continue earlier work, choose **Find existing** and select the conversation by title, activity time and ID.
3. For Codex work still running on a separate App Server, enter its private Unix socket under **Connect to a running Codex server** before searching. Use the socket the original client connected to. The socket's parent directory must be private to your account. For example, a server launched with `codex app-server --listen unix:///path/to/private/codex.sock` and a terminal launched with `codex --remote unix:///path/to/private/codex.sock` share that server. The office can join a turn in progress there. On a client that keeps its server private, finish or interrupt the turn and **close the original client**. Select **Hand over this conversation** in Projects. The office resumes its saved ID.
4. For a running Claude Code terminal, enter `/bg` in the original session. Choose **Find existing** again, then select its running entry. The office attaches to the background job. To give this existing session office assignments, follow the plugin commands in the session window. A fresh session or saved conversation launched by the office loads the plugin for that launch.
5. Choose **Open terminal** to use native commands, respond to the provider's prompts and work with files. For an office instruction, enter a project-relative filename under **Project file**. Codex receives supported images as native image inputs. Claude reads the file in the selected project. Keep your usual project permissions. A first visit to a folder can present the provider's normal trust question.

One office terminal view accepts typing at a time. **Take control of terminal** transfers input to another view. Closing the window detaches the view. **Disconnect** releases the office connection after current work finishes. To pick the work up outside the office, resume the displayed conversation ID from its project folder, or attach to its existing Claude background job. Close the prior writer before a saved-session handover. The office never asks the provider to fork to resolve contention.

## Give an Odd work

1. Open the intended session. Under **Odd allowed to send work**, choose the Odd. This gives that Odd access to a native session with your project's tools and settings. Choose **Only me** to revoke the grant.
2. In the Odd's chat, describe the project work you want. The Odd sees the sessions shared with it. It can read its request status and send an assignment. It cannot type in the terminal, approve a command or grant itself access.
3. At Read, the Odd can look up its assignments. At Draft, the proposed instruction appears on the Desk and opens the exact session. **Take over and send** runs the displayed instruction as you, with the permissions already configured in your native session. At Act, a shared session can accept work directly. The office checks the Odd's current access again before sending.
4. Open Projects to see the answer. Results include any file references returned by the native tool. An Odd's result also reaches its Desk report. Work assigned from an office thread queues a pickup on that same thread. Revocation cancels waiting work. Inspect an assignment that already reached the provider before stopping it.

During a Codex turn, **Send correction** steers that turn. **Stop** targets the turn shown when you clicked. A resolved permission request cannot authorize a later one. With Claude, a correction waits for the paired plugin to read it. The office distinguishes a pending correction from one Claude received. For a Claude interrupt, check the terminal before clearing the request. The owner can also speak directly in either terminal.

## If delivery is unclear

The office saves the instruction before submitting it. A connection failure after submission can leave a tool action complete even though the office missed its reply. Reconnect, inspect the native history and project files, then clear the uncertain request. Sending a new instruction is a separate action. If Claude is waiting to take an assignment, open its terminal to see trust, sign-in, permission or plugin messages. Managed installations must permit the plugin and its monitor. An attached background job belongs to Claude and can outlive the office.

## Review the implementation

| Question                                                    | Start here                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which Odd may send this request, and what survives a crash? | `packages/ledger/src/project-sessions.ts` locks the session row when granting access or claiming the next request. One transaction completes the request and creates the Odd's delivery. The additive migration creates two tables.                                                     |
| Which client owns this conversation?                        | `apps/office/src/lib/server/project-sessions/controller.ts` holds one runtime per office connection. The Codex adapter shares the office's authenticated loopback server with its terminal, or joins the socket chosen by the owner. Matching includes the server and native thread ID. |
| How does work reach interactive Claude?                     | `claude-project.ts` creates a local plugin for one pairing. Its monitor announces a request ID. `packages/ledger/src/project-session-tools.ts` checks the native session ID and real project path before reading the assignment or posting a reply. It gets no database credentials.    |
| Who can control the terminal?                               | The office's existing owner-page checks guard the command route. The event stream also checks its reader. The Odd's MCP tools expose only listing and assignment. CLI arguments are passed directly to the executable.                                                                  |
| What does the desktop include?                              | The stage includes the local plugin, ledger helper, terminal library and native helper. The macOS release signs the helper and terminal library along with the bundled runtime.                                                                                                         |

## Exercise a change

Run `npm test -w @oddboro/ledger`, `npm test -w @oddboro/office`, `npm run check-types` and `npm run lint` from the checkout using Node 24 or later. The project-session ledger tests use a disposable database. They exercise competing claims, changed grants, repeated replies and delivery to a thread.

For a native test, run a separate office on unused office and database ports with a temporary office home. Use a disposable project and signed-in clients. Keep a second conversation open in the same folder. Give the first conversation a unique fact, ask an Odd to use a project-only file, correct the assignment, then inspect the reply in both the office and the original client. Compare the full native IDs. Confirm that the second conversation received nothing. Repeat with permission denial, a stopped turn, an office restart and a revoked Odd.

On a release machine, stage the desktop with the repository's smoke test. Open both terminals in the installed application, enter and resize text and exercise a native permission prompt. Windows Claude plugin monitors require Git Bash. Test a managed machine with the plugin disabled as well as a machine where it is allowed.

To run the two-provider read and resume check yourself, open the disposable office first. Pass its loopback URL and an existing disposable project folder to the script below. It creates one uniquely named fixture, asks each provider to return the value in it, verifies the original conversation IDs and removes the fixture. The native clients retain their test conversations. Open the matching Projects entry if a provider asks for permission.

```sh
node apps/office/scripts/check-live-projects.ts http://127.0.0.1:4951 /absolute/path/to/test-project
```

## What the live review exercised

On Apple silicon, the staged desktop server ran Codex CLI 0.167.0 and Claude Code 2.1.319 with their native sign-ins. Both read a fresh project file, returned its contents through the office and resumed the same native ID. A project-only skill supplied information used in each provider's answer.

- A separate Codex client started a turn on its own private socket. The office joined it and steered it. The original client saw the corrected reply. A stale Stop left the next turn alone, and its own Stop interrupted it. A real approval allowed one fixture write. A denial on a separate request left its file absent.
- A separate Claude background job already knew a test word. The office attached to that job, installed the local plugin in the test project and reloaded it in the existing conversation. An assignment came back with both the remembered word and the new instruction. In another live session Claude picked up a correction before returning a project skill's result.
- An Odd used its office MCP tools to submit work, got the file reference back and received one Desk report. Revoking the grant blocked a second instruction from the same MCP client. Two browser tabs transferred native terminal control explicitly.

The platform workflow builds and starts the staged office and checks terminal input and resizing on the Mac, Linux and Windows release architectures. It uses local fixtures. An authenticated provider run on another OS, a managed organization's plugin policy and signed installer distribution require their own release checks.
