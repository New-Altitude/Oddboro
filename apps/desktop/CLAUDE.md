# apps/desktop

Oddboro for the Mac, Linux and Windows. A Tauri v2 shell in Rust that runs
the office server (`apps/office`, built with adapter-node) on a bundled Node
and shows it in a window. On a Mac: Apple Silicon, macOS 13 or later, a signed
and notarized `.app` in a `.dmg`. On Linux: an AppImage for x86_64 or arm64,
on a systemd desktop with a Secret Service keyring and a notification
service. On Windows: a per-user installer (NSIS) for x64 or arm64, Windows 10
or 11, not code-signed yet. No UI framework: the only page of its own is
`loading/index.html`.

What differs between the systems is in `#[cfg(...)]` branches, one per
function: the home and log folders and the PATH (`env.rs`), asking Node to
quit, keeping the computer awake and notifications (`server.rs`), opening
links, the tray icon and closing the window (`main.rs`), and reopening after
an update (`update.rs`).

## What the shell does

1. Checks for a newer version before anything else (`update::on_launch`,
   5 second timeout). If there is one, the loading window says "Updating
   Oddboro to X.Y.Z", and the shell downloads it, checks its signature,
   installs it and opens the new version. Offline or any error, it logs the
   problem and starts as it is. See "Updates" below.
2. Checks the port. If anything answers on it, shows "another office is
   already running" and quits. It never attaches to that office.
3. Reads the owner's login-shell PATH once (`$SHELL -l -c`, 5 second
   timeout; `/bin/zsh` on a Mac and `/bin/sh` on Linux when `SHELL` is
   unset), then adds `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`
   and `~/.claude/local` if missing. Windows has no login shell: the app's
   own PATH, plus `%USERPROFILE%\.local\bin` (Claude Code's and uv's
   installers), WinGet's `Links` folder and `C:\Program Files\Git\cmd`.
4. Starts Node, shows the small loading window, and asks `GET /` every half
   second for up to 90 seconds. When it answers, the main window opens the
   office and the loading window closes. On timeout, a dialog shows the last
   lines of the log and the app quits.
5. Writes Node's stdout and stderr to `~/Library/Logs/Oddboro/office.log` on
   a Mac, `~/.local/state/oddboro/office.log` on Linux (`XDG_STATE_HOME`
   wins when set) and `%LOCALAPPDATA%\Oddboro\Logs\office.log` on Windows,
   with its own lines prefixed `oddboro:`. Past 10 MB the log
   moves to `office.log.1` when Node next starts.
6. Restarts Node when it dies: after 1s, 5s, then 30s, at most 5 times in 10
   minutes. Then it shows the log tail and quits. After a restart the main
   window reloads.
7. Keeps the computer awake while Node runs. On a Mac,
   `/usr/bin/caffeinate -s -w <node pid>`, on AC power only. On Linux,
   `systemd-inhibit --what=sleep --mode=block cat`, with `cat`'s stdin a pipe
   the shell holds: it lets go when Node stops or the shell dies. It holds on
   battery too, and closing a laptop's lid still suspends it (logind ignores
   inhibitors for the lid by default). On Windows, a thread that called
   `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` and waits;
   Windows lets go when it ends. It too holds on battery, and the lid still
   sleeps the laptop.
8. Closing the main window hides it, and the shell tells the page
   (`oddboro:hidden`), which pauses the music; showing the window again
   (`oddboro:shown`) plays it on (`apps/office/src/lib/ui/music.svelte.ts`). The Dock icon and the menu bar item
   (Open Oddboro, Open at login, Quit Oddboro) bring it back. Open at login
   uses `tauri-plugin-autostart`: a LaunchAgent on a Mac, an entry in
   `~/.config/autostart` naming the AppImage on Linux. On Linux the tray shows
   only where something owns `org.kde.StatusNotifierWatcher` on the session
   bus (KDE, most tiling setups, GNOME with the AppIndicator extension). With
   none, as on GNOME when it ships, closing the window quits Oddboro, since
   nothing could bring it back. On Windows the tray icon is the app's
   coloured icon, and Open at login is a Run entry in the registry. Opening
   Oddboro again while it runs shows its window
   (`tauri-plugin-single-instance`, Linux and Windows; the Mac does this
   itself).
9. On quit, sends Node SIGTERM, waits up to 10 seconds, then SIGKILL. A
   SIGTERM, SIGINT or SIGHUP to the shell itself quits the same way. A second
   one kills the shell at once. Windows has no SIGTERM: the shell closes
   Node's stdin, which the server takes as "quit", waits the same 10 seconds,
   then ends it with `TerminateProcess`. Node runs with `CREATE_NO_WINDOW`,
   so neither it nor anything it starts opens a console window.
10. Keeps links to the office's own origin in the window. Links to any other
    origin, `mailto:` and `tel:`, and every `target="_blank"` or
    `window.open`, open in the default browser.

The page gets no Tauri IPC: there are no capability files, and remote pages
never get IPC without one.

## The contract with the server

- Entry: `<resources>/server/apps/office/build/index.js`, run with cwd
  `<resources>/server/apps/office`.
- Node: the sidecar beside the shell, `Contents/MacOS/node` on a Mac,
  `usr/bin/node` in the AppImage and `node.exe` in the install folder on
  Windows, from `src-tauri/binaries/node-<target>` (`aarch64-apple-darwin`,
  `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, or
  `x86_64-pc-windows-msvc.exe` and `aarch64-pc-windows-msvc.exe`). `build.rs` passes the target to the code as
  `ODDBORO_TARGET`, so a debug build finds its copy.
- Env Node gets:

| Variable                       | Value                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `PORT`                         | the port, 4500 unless the shell's env sets `ODDBORO_PORT`    |
| `ODDBORO_PORT`                 | the same                                                     |
| `HOST`                         | `127.0.0.1`                                                  |
| `ORIGIN`                       | `http://127.0.0.1:<port>`                                    |
| `ODDBORO_HOME`                 | `~/.oddboro` (`%USERPROFILE%\.oddboro`), unless set          |
| `ODDBORO_CODE`                 | `<resources>/server`                                         |
| `ODDBORO_MAGPIE_BINARY`        | `<resources>/server/magpie/magpie` (`magpie.exe` on Windows) |
| `ODDBORO_DB_PORT`              | passed through when the shell's env sets it                  |
| `PATH`                         | the login-shell PATH from step 3                             |
| `ODDBORO_VERSION`              | the app's version, like `0.0.4`                              |
| `ODDBORO_UPDATE_TOKEN`         | a fresh secret per run, release builds only                  |
| `ODDBORO_SECRETS`              | `shell` on a Mac: the shell keeps the office's secrets       |
| `ODDBORO_GOOGLE_CLIENT_SECRET` | the Google sign-in client's secret, when the build had one   |

- `ODDBORO_APP=1`. With it the server quits on SIGTERM once its HTTP server
  closes, and when its stdin closes (`apps/office/src/hooks.server.ts`). It
  also has no web address: onboarding skips the address step and the office
  never touches Caddy.
- Node's stdout is a pipe too. A line `oddboro:notify <title>\t<text>` is a
  notification, which the shell shows as Oddboro's: `mac-notification-sys`
  with the Glass sound on a Mac, `notify-send --app-name=Oddboro` on Linux,
  and a toast through `tauri-winrt-notification` on Windows, under the app's
  identifier, which the installer gives its Start menu shortcut. A
  line `oddboro:update-check` is the owner's Check now. A line
  `oddboro:secret <json>` asks for the Keychain (below). Every other line goes
  to the log.
- The Keychain, on a Mac (`src-tauri/src/secrets.rs`). The office sends
  `oddboro:secret {"id":n,"op":"list"|"legacy"|"set"|"remove","account":"...","value":"..."}`
  and the shell answers on Node's stdin with one line, `{"id":n,"ok":true,...}`
  or `{"id":n,"ok":false,"error":"..."}`. `list` gives `secrets`, every
  account and value under the service `com.oddboro.office`; `legacy` gives
  `accounts`, the names alone under the old service `oddboro`, which macOS
  shows without a prompt. The shell reads and writes through Apple's Security
  framework (`security-framework`), in the login keychain, so each item trusts
  only Oddboro, by its Developer ID team and bundle id: updates keep access,
  and any other program gets macOS's "allow access" prompt. No line holding
  `oddboro:secret` ever reaches the log, whole or garbled. The office opts in
  from `hooks.server.ts` (`useShellSecrets` in the ledger); its child
  processes never do.
- Node's stdin is a pipe the shell holds open. It closes when the shell dies
  by any means, Force Quit included, so a force-quit shell never leaves Node
  running on the port.
- `ODDBORO_SERVER_URL`, when set, skips Node and opens that URL. Use it to run
  the shell against `vite dev`.

## Bundled Magpie runtime

`npm run magpie:build` at the repo root runs `scripts/magpie-runtime.ts`
inside this app. It checks the pinned archive and embedding patch in
`magpie/`, then builds a headless binary without starting it or reading
sign-ins. It requires Git, tar and the local Go toolchain recorded by
`magpie/source.json`; the build does not fetch a Go toolchain. Source and
patch checksums are required before a build can be accepted.

The output is `stage/magpie/`: `magpie` or `magpie.exe`, its license and
`magpie-runtime.json` and `THIRD_PARTY_NOTICES.txt`. The notice inventory copies the
Go runtime and dependency notices from the exact target build sources. A cached
binary is rebuilt if either notice file is missing or changed. The manifest records the source commit, embedding
patch hash, binary hash, version, platform and chip. On a Mac the helper is
signed before hashing. `scripts/stage.ts` builds this directory as part of
staging, and Tauri includes it with the server resources. The shell gives
Node its path in `ODDBORO_MAGPIE_BINARY`.

The office checks the manifest and both embedded listeners before using the
runtime. It owns the child process and private office state; an existing
Magpie connection does not transfer process ownership. See
[the integration guide](../../docs/magpie.md) for supported sign-ins and the
remaining packaged setup walkthroughs and real-provider evidence. A local
source build is not evidence that the runtime has shipped on all systems.

## Updates

Every update is required. `src-tauri/src/update.rs` runs them with
`tauri-plugin-updater`, in release builds only.

1. The app checks
   `https://github.com/New-Altitude/Oddboro/releases/latest/download/latest.json`.
   A draft release is invisible there, so nothing updates until the owner
   publishes one. `ODDBORO_UPDATE_URL` replaces the address, for testing on
   this Mac only.
2. On launch it installs a newer version before the server starts (step 1
   above).
3. While the office runs it checks every 4 hours, and when the server writes
   `oddboro:update-check` (Check now in Setup). It downloads a new version in
   the background and checks its signature against the public key in
   `tauri.conf.json`, then `POST`s `{ version, notes }` to
   `http://127.0.0.1:<port>/api/update` with the header
   `X-Oddboro-Update-Token`. A check that finds nothing posts
   `{ checked: true }`; one that fails posts `{ failed }`.
4. Then it asks `GET /api/update` every 30 seconds. When the answer has
   `install: true` (the server decides, see `apps/office/CLAUDE.md`), it stops
   Node the usual way (`server::stop`), installs, and opens the new version.
5. On a Mac it reopens itself with `open -n` and passes every `ODDBORO_*`
   variable on with `--env`, since launchd drops the old process's
   environment. Tauri's own `restart()` would lose them. On Linux the updater
   replaces the AppImage file in place (the path in `APPIMAGE`), and the shell
   starts it with its own environment plus `ODDBORO_RELAUNCH_FROM=<its pid>`.
   The new one waits up to 30 seconds for that pid to go
   (`update::wait_for_old`) before it claims the single instance and the
   port. The AppImage must sit somewhere the owner can write, such as
   `~/Applications`. On Windows the updater runs the new version's installer
   in passive mode (a progress bar, no questions) and ends the shell itself,
   after the shell has stopped Node; the installer opens the new version
   when it is done. Only a failed install comes back to the shell, which
   reopens the same version the Linux way, with `ODDBORO_RELAUNCH_FROM`.
6. The private key that signs updates lives outside the repo, in
   `~/.tauri/oddboro-updater.key` on the owner's Mac, its password in the
   keychain (`security find-generic-password -s oddboro-updater-key -a password -w`),
   and both in the GitHub secrets below. Losing it means no installed app can
   update again.

## Files

- `src-tauri/src/main.rs`. Windows, the menu bar item, links, and the
  startup steps.
- `src-tauri/build.rs`. Tauri's build, and the target triple as
  `ODDBORO_TARGET`.
- `src-tauri/src/server.rs`. Starting, watching, restarting and stopping Node.
- `src-tauri/src/env.rs`. Port, home, log path and the login-shell PATH.
- `src-tauri/src/secrets.rs`. The office's secrets in the Mac's Keychain, and
  the line protocol it asks with.
- `src-tauri/src/update.rs`. Checking, downloading and installing updates,
  and asking the server when.
- `src-tauri/tauri.conf.json`. The app, with no sidecar or resources, so
  `cargo check` and `cargo clippy` work before anything is staged.
- `src-tauri/tauri.bundle.conf.json`. Adds `externalBin` and the
  `../stage/` to `server/` resource map. `npm run bundle` and `release.ts`
  merge it.
- `src-tauri/tauri.release.conf.json`. Turns on `createUpdaterArtifacts`.
  Only `release.ts` merges it, on a Mac, since it needs the updater key.
- `src-tauri/tauri.linux.conf.json`. Tauri merges it on Linux by itself: the
  AppImage target, with GStreamer bundled (`bundleMediaFramework`), since the
  AppImage points GStreamer at its own plugins and the office plays music.
- `src-tauri/tauri.windows.conf.json`. Tauri merges it on Windows by itself:
  the NSIS target, installed per user under `%LOCALAPPDATA%` with no
  administrator, the WebView2 bootstrapper for a Windows without WebView2,
  and the updater's passive install.
- `loading/loading.js`. The loading window's words: "Opening the office", or
  "Updating Oddboro to X.Y.Z" when the shell sets `window.oddboroUpdating`.
- `src-tauri/Entitlements.plist`. `allow-jit` and
  `allow-unsigned-executable-memory`, which V8 in Node needs under the
  hardened runtime. No App Sandbox: the server spawns `claude` and reads
  `~/.claude`.
- `scripts/stage.ts`. Builds the office and the sprites, then lays out
  `stage/`: the office build, which bundles every third-party package the
  office itself runs, the production `node_modules` that the ledger, sprites
  and world load, at the versions installed in the repo, and those three as plain
  JavaScript (types stripped, `.ts` imports rewritten) in
  `node_modules/@oddboro/`, with their files beside them. Packages' test
  folders (`__screenshots__`, `__tests__`) stay out, and a staged path
  longer than 180 characters fails the stage: the Windows installer's
  builder stops at 260, and GitHub's runner puts the stage 60 deep. It fetches the Node
  binary for this machine's Node version, system and chip, and checks it
  against nodejs.org's sums (Windows's comes as a zip, unpacked with
  Windows's own `tar`). `--smoke` starts the stage on port 4590 with a
  throwaway home, waits for it to answer, and checks it quits when asked
  (SIGTERM, or a closed stdin on Windows):
  `node apps/desktop/scripts/stage.ts --smoke`.
- `stage/` must hold no folder symlinks. The bundler walks it without
  following them, so a linked folder never reaches the app.
- `stage/`, `src-tauri/binaries/`, `src-tauri/target/` and `src-tauri/gen/`
  are gitignored.

## Releases come from GitHub only

Public releases are built on GitHub's runners (Mac, Ubuntu 22.04 on x86_64
and arm64, and Windows on x64 and arm64), never on a developer's computer: Tauri writes the source
folder's full path into the app, and on a developer's computer that path
names them. The Ubuntu runners are the oldest supported Ubuntu, so the
AppImages run on systems with an older glibc too. `scripts/release.ts` maps Rust's
own source paths to neutral ones and refuses to sign a build that still holds
the builder's home folder. Local builds stay for testing: `npm run bundle`, or
a signed `tauri build --bundles app` run beside the owner's office on 4510.

`.github/workflows/release.yml` runs by hand, and on every push to `main`
that changes what goes into the app: `apps/desktop`, `apps/office`,
`packages`, `.nvmrc` or the workflow itself, but not a `CLAUDE.md`. A merge
that touches only the site or the docs builds nothing. Neither does a
lockfile-only update, so run it by hand for one that should ship. Five jobs:

1. `version` picks the next patch version from the highest PUBLISHED release
   tag (none gives `0.0.1`), and writes GitHub's generated notes. A draft
   never takes a number. The committed version never changes; the build sets it
   (`release.ts --version`).
2. `mac` installs Node from `.nvmrc`, Rust stable with `aarch64-apple-darwin`
   and the repo's packages, imports the Developer ID certificate into a
   temporary keychain, and runs `release.ts`: build, sign, notarize with the
   API key, staple, the updater archive and its signature, and a
   `latest.json` for `darwin-aarch64`.
3. `linux`, once on x86_64 and once on arm64, installs the libraries Tauri
   builds against and runs `release.ts`: the AppImage, its signature, a copy
   under the site's name, and a `latest.json` for `linux-x86_64` or
   `linux-aarch64`. Only the updater key and the Google client's secret are
   needed.
4. `windows`, once on x64 (`windows-latest`) and once on arm64
   (`windows-11-arm`), installs Rust where the runner lacks it, on arm64
   names the Windows SDK's `rc.exe` and Visual Studio's clang (the registry
   points Rust's build at a Windows Kits folder without `rc.exe`, and ring
   needs clang there), and runs
   `release.ts`: the installer, its signature, a copy under the site's name,
   and a `latest.json` for `windows-x86_64` or `windows-aarch64`. Only the
   updater key and the Google client's secret are needed. The installer is not code-signed, so Windows
   SmartScreen warns before it runs.
5. `draft` merges the five `latest.json` files into one, deletes any draft
   of the same version, and creates a DRAFT release `vX.Y.Z` on the merge
   commit, with the notes and these assets:
   `Oddboro.dmg`, `Oddboro-x86_64.AppImage`, `Oddboro-aarch64.AppImage`,
   `Oddboro-x64-setup.exe` and `Oddboro-arm64-setup.exe` (the site's
   Download buttons link to `releases/latest/download/` under these names,
   so every release carries them), the versioned `.dmg`, the Mac updater
   archive and its `.sig`, each versioned AppImage and installer and its
   `.sig`, and `latest.json`.
6. The owner reads the draft and presses Publish. Installed apps pick it up at
   their next check, and the next build takes the next version. Until then,
   each merge replaces the draft, so it always holds the newest `main`.

The repo must be public for installed apps to reach the release. While it is
private, `latest.json` answers 404 to them.

### Secrets

Set each as a secret of the `release` environment (the repo's Settings,
Environments, release), never as a repo secret. Only `main` may use that
environment, so a workflow run from any other branch, or a pull request, never
sees the keys. Set one with `gh secret set <NAME> -R New-Altitude/Oddboro --env
release`. Never commit a value.

| Secret                               | What it is                                                                                                               | How to make it                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APPLE_CERTIFICATE`                  | The Developer ID Application certificate and key, as base64                                                              | Keychain Access, export "Developer ID Application: New Altitude, Inc." as `cert.p12` with a password, then `base64 -i cert.p12 \| pbcopy`              |
| `APPLE_CERTIFICATE_PASSWORD`         | The password set on that export                                                                                          | Chosen at export                                                                                                                                       |
| `APPLE_API_KEY`                      | The App Store Connect API key, the `.p8` file's contents                                                                 | App Store Connect, Users and Access, Integrations, Team Keys, a key with Developer access. Download `AuthKey_<id>.p8`, then `pbcopy < AuthKey_<id>.p8` |
| `APPLE_API_KEY_ID`                   | That key's ID                                                                                                            | The Key ID column on the same page                                                                                                                     |
| `APPLE_API_ISSUER`                   | The team's issuer ID                                                                                                     | The Issuer ID above the keys on the same page                                                                                                          |
| `TAURI_SIGNING_PRIVATE_KEY`          | The updater signing key, for every build                                                                                 | `pbcopy < ~/.tauri/oddboro-updater.key`                                                                                                                |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password                                                                                                             | `security find-generic-password -s oddboro-updater-key -a password -w \| pbcopy`                                                                       |
| `KEYCHAIN_PASSWORD`                  | Any random string, for the runner's temporary keychain                                                                   | `openssl rand -hex 24 \| pbcopy`                                                                                                                       |
| `GOOGLE_OAUTH_CLIENT_SECRET`         | The Desktop OAuth client's secret for Google sign-in. Google treats it as not confidential, but it stays out of the repo | New Altitude's password manager, "Oddboro Google OAuth client"                                                                                         |

### A test build

`release.ts --test` lets the app take an `http://` `ODDBORO_UPDATE_URL`. On a
Mac it signs with the Developer ID in this keychain and skips notarizing. Never
ship one.

```sh
export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/oddboro-updater.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s oddboro-updater-key -a password -w)"
ODDBORO_RELEASE_URL=http://127.0.0.1:4598 \
  node apps/desktop/scripts/release.ts --version 0.0.91 --test --out /tmp/oddboro-0.0.91
```

## Icons and signing

- The icons are Oddboro's mark: a night rounded square with an ember ring.
  `logo.png` in the site and the office is the same ring on night to the
  edges. Regenerate with
  `npm run tauri -w @oddboro/desktop -- icon <1024px png> -o src-tauri/icons`,
  then delete the `android/`, `ios/`, `Square*`, `StoreLogo.png` and
  `64x64.png` files it also writes. `icon.ico` stays: Windows builds embed
  it. `icons/tray.png` is the menu bar ring, a template image macOS tints;
  Windows shows `icons/32x32.png` in the tray instead.
- No `signingIdentity` in the config: `release.ts` passes the Developer ID
  as `APPLE_SIGNING_IDENTITY`.

## Commands

Run from the repo root.

```sh
npm run shell -w @oddboro/desktop     # tauri dev against ODDBORO_SERVER_URL, default http://127.0.0.1:4500
npm run bundle -w @oddboro/desktop    # tauri build for this machine: the .app and .dmg, the AppImage, or the installer
npm run check-types -w @oddboro/desktop   # cargo check
npm run lint -w @oddboro/desktop      # cargo clippy -D warnings, cargo fmt --check, prettier
```

`npm run bundle` writes to `src-tauri/target/release/bundle/`.

To build on Linux, install Rust and the libraries Tauri builds against first.
On Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel libxdo-devel gcc gcc-c++ patchelf
```

The AppImage bundles the GStreamer plugins installed on the build machine.
Its bundler looks in Debian's folders, so on Fedora name them before
`npm run bundle` (`release.ts` does this by itself):

```sh
export GSTREAMER_PLUGINS_DIR=/usr/lib64/gstreamer-1.0 GSTREAMER_HELPERS_DIR=/usr/libexec/gstreamer-1.0
```

`shell` and `bundle` are not named `dev` and `build`, so the root
`npm run dev` and `npm run build` never start a Rust build or a window.
Bundling needs `stage/` and the Node binary first.

A debug binary (`cargo build` in `src-tauri/`) has no bundle. It falls back
to `src-tauri/binaries/node-<target>` and `stage/`. On a Mac its error
dialogs never show: without a parent window they go through
`CFUserNotification`, which needs a bundle. To run it beside the owner's
office:

```sh
ODDBORO_PORT=4510 ODDBORO_DB_PORT=54510 ODDBORO_HOME=/tmp/oddboro-test-home \
  src-tauri/target/debug/oddboro
```

## Pinned versions

- `@tauri-apps/cli` 2.12.4
- `tauri` 2.12.5, `tauri-build` 2.7.4
- `tauri-plugin-autostart` 2.7.0, `tauri-plugin-dialog` 2.8.4
- `tauri-plugin-updater` 2.14.1, `serde_json` 1.0.154
- `getrandom` 0.3.4, for the update token
- `libc` 0.2.191 (Mac and Linux)
- `mac-notification-sys` 0.6.15 (Mac only)
- `security-framework` 3.7.0 (Mac only), for the Keychain
- `tauri-plugin-single-instance` 2.5.3 (Linux and Windows)
- `zbus` 5.19.0 (Linux only; the plugin brings the same zbus)
- `windows-sys` 0.61.2, `tauri-winrt-notification` 0.8.1 (Windows only)
