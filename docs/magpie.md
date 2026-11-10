# Magpie model connections

Status: implemented on this integration branch. This document does not claim
upstream adoption, a published release, or live provider acceptance.

For the source map, design reasons and extension checks, see the
[maintainer guide](magpie-architecture.md).

Choose the Magpie tile under Your AI, in Setup or onboarding. New Magpie
setups use Pi, which is included with Oddboro on Mac, Linux and Windows.
There is no separate Pi CLI to install or Pi account to sign in to.
After onboarding, Setup stays available in the office header on a phone too,
so model connections and routing remain reachable from the same interface.

Pi runs the Odd's work. Magpie supplies its providers, accounts, model
catalog and routing groups. Existing explicitly chosen Claude Code or Codex
runners remain alternatives on their supported systems; choosing Magpie does
not silently migrate those configured runners.

## Choose the Magpie tile

1. Click Magpie. Oddboro checks the computer running Oddboro on demand,
   not the device showing the browser. Saved managed and server targets stay
   authoritative; detection does not silently replace them.
2. A positively identified local Magpie gateway with a public model catalog
   connects for model use automatically. Its published models and routing
   aliases appear without a management key. Select a route to use it.
3. Management is optional. Choose Manage connection only to edit that
   installation's providers, accounts or groups here. A private Browser
   access descriptor can authorize it where supported; otherwise paste the
   full access link once, or choose Enter URL and key manually.
4. If detection finds no existing connection, Oddboro starts its bundled
   runtime with private state. A detected installation needing authorization
   is not replaced automatically. Use built-in Magpie remains an explicit
   separate-copy choice. A source checkout needs `npm run magpie:build` first.
5. Choose an available model or routing alias. An empty built-in copy first
   needs a provider. Existing explicit Claude Code or Codex runners stay
   selected; new Magpie setups use included Pi.

The Magpie tile stays selected while its first model is being configured.
Click it again to retry after enabling an existing installation's Browser
access; a check already in progress cannot start twice.
If a gateway needs authorization before it can supply models, the compact
connection choice also offers
Use built-in Magpie. This is an explicit choice, even when an existing or
stale saved installation was detected. The built-in copy has separate
providers, models and groups; it does not import the existing catalog.
Switching from a connected installation asks for confirmation and keeps it
available if the new setup fails.
The direct Claude plan and API-key panel stays hidden. Setup names the
missing Magpie step instead of asking for a direct Claude sign-in. Click a
direct tool tile to return to direct access explicitly.

The included Pi runner stays behind the single Magpie tile. It does not add
a second provider selector. Once a provider and route are ready, setup can
continue without a Claude Code or Codex install or direct vendor login.
Missing or incompatible Pi bundle files require rebuilding or reinstalling
Oddboro, not a CLI install or update command.

For a fresh built-in copy, Connect a provider in the Office model card jumps
to its native provider and supported sign-in controls. After connecting one,
choose a model in that same picker. Groups & routing beside the picker jumps
to the native group controls. No desktop popup or extra Pi login is needed;
the owner chooses the model or group explicitly.

An existing explicit Claude Code or Codex choice is preserved where that
runner is offered. Choose Use included Pi in the selected Magpie panel to
switch that office deliberately, keeping its connection and selected route.
Direct tool tiles remain available for owners who choose
them. An Odd's advanced Model controls can name Pi (built-in); Pi requires an
explicit or inherited Magpie route and has no direct model or sign-in mode.
A runner change retains a selected gateway route through the validated
runner/model save. An unavailable route blocks the next run rather than
falling back to a direct account.

## Use models without management access

Models connected means Oddboro can use the existing gateway's published
catalog. It does not claim access to the installation's private management
settings. The office and each Odd use the same exact model IDs, including
published routing aliases. The UI does not invent provider accounts, group
members or routing rules from those names.

Manage connection is optional. It opens the access-link form only when you
choose it. Until management is authorized, provider edits, account sign-ins,
account discovery, group edits and request inspection are hidden. The server
also refuses those management actions before contacting Magpie. Cancel or a
failed management upgrade keeps the working gateway, catalog and route.
A successful upgrade reveals the real management settings and its persistent
shared-edit notice.

A listed route is a catalog entry, not a paid model request or a new provider
health check. Model requests can still fail if an upstream account expires
or its provider rejects the request. Oddboro does not make a model request
merely to detect a gateway or populate these controls.

An existing Magpie web interface normally uses `http://127.0.0.1:3430`, and
its inference gateway normally uses `http://127.0.0.1:3425`. Use the addresses
of that installation if they differ. The management run key and an inference
token are separate credentials. Credentials read from a private Browser
access descriptor remain server-side. Connecting does not install, update
or take over the existing process. The first-click check does not search
provider accounts, start a vendor login, or poll in the background.

On Windows the adapter cannot prove the private descriptor's file access
permissions, so automatic descriptor authorization is refused. Use the
one-time access-link connection, or its explicit manual URL and key fallback.
Saved authorized connections
can still be reused; the descriptor check does not bypass authentication.

Editing an existing installation changes its shared setup for other clients
too. The connection form acknowledges that effect and the connected panel
keeps the notice visible.

## Use groups and models from an existing tray app

The built-in copy has its own providers, models and groups. If it shows none,
that does not mean your separate tray app has none. A detected existing
public gateway can supply its model and group aliases without opening its
management interface; click Magpie to check that connection first. While Built-in Magpie is
connected, choose Use existing Magpie to try the known local inference
gateway on that click. A verified public catalog switches to its actual
model and routing aliases without requiring a management key.

If that check fails, the working connection and route stay active. The local
gateway form lets you retry or enter a different local inference port. No
probe or switch starts merely by viewing the connected panel. Choose Connect
management instead for a protected gateway or to authorize editing. Manage
connection on a model-use connection only opens that management upgrade; it
does not reattach or downgrade the gateway.

To edit that installation's setup, paste its full Browser access link. Oddboro
extracts the management authorization on the server, so you do not need to
find or copy the key separately. If that installation only supplies a URL
and key, choose Enter URL and key manually. You may need to enable Browser
access in that app once. Viewing
Oddboro on a phone does not open the desktop tray or search that phone for
Magpie. Use Connect to a Magpie server for an installation on another computer.
The Oddboro host must be able to reach it; an inaccessible endpoint is not
evidence that it is uninstalled.

A local access-link connection reads the inference address and token from the
authenticated Magpie settings. Leave Inference settings empty to use them;
enter an override only when needed. A custom port or protected local gateway
does not require extracting its token from the link.

Cancel and failed authentication keep the current built-in connection and
route. Only a verified successful connection switches to the existing
installation and shows its models, groups and shared-change notice. Choose a
ready route there if the former built-in route is unavailable. The existing
shared setup is not changed merely by opening or canceling the form.

## Connect to a Magpie server

Choose Connect to a Magpie server, or choose On a Magpie server in the
existing-connection form. This works while the current built-in or existing
connection is still active. It does not search local endpoints or read host
credentials.

Paste the server's full HTTPS Browser access link, then enter its externally
reachable HTTPS inference URL and separate inference API token. Alternatively,
choose Enter URL and key manually for its HTTPS management URL and run key.
The manual management and inference URLs must be root addresses with no
username, password, path, query or fragment. They may be the same address
when that server exposes management and inference on one port. The access
link is submitted privately, not opened as a browser page. The inference token is required in server mode.
These addresses must be reachable from the computer hosting Oddboro, not
just the phone or browser showing the page.

The management key authorizes the connection once; the inference token
authorizes model requests. They stay in private server-side connection
settings. The access-link field is a password field. Entered links and keys
clear on submission, cancellation, location or input-mode changes, and when
the panel closes; they are not placed in navigation, logs or browser storage.
No desktop
popup is assumed. The current connection remains available during entry,
cancellation and failed verification. Only successful authentication and
contract checks switch the active connection. The server's models and groups allowed by the inference token then appear,
with the persistent notice that edits affect its other clients. A token with
a restricted model catalog does not expose routes outside that catalog.

Disconnect stops Oddboro's use and preserves the Magpie provider/group data.
It stops a built-in process owned by this office. It does not stop an
existing installation. Saved Oddboro model selections remain unavailable
until reconnected or changed back to direct access.

## Connect providers and accounts

These controls require management access, through the built-in runtime or
an authorized existing connection. A model-use connection can use published
routes without any of these steps.

Add an API provider with its preset or endpoints, key and model IDs. Blank
model IDs use Magpie's provider list. API keys have native add, replace,
on/off and remove controls. Saved values never return to the page; forms
clear entered keys after submission or cancellation. Removing a provider or
key, and turning a key off, asks for confirmation.

The built-in runtime supports the Codex/ChatGPT browser sign-in advertised
by its embedded contract. Other built-in subscription sign-ins and plugin
sign-ins are unavailable. This does not add support for another Oddboro
agent tool or operating system.

Built-in discovery starts only after Search supported local sign-ins. It
lists supported file-backed Codex sign-ins and connects one selected source
with read access. It does not copy or renew that source's tokens. Renew an
expired source sign-in in Codex. A sign-in created inside the built-in
runtime instead belongs to its private state.

Existing mode offers the supported built-in sign-ins and installed provider
plugin methods reported by that installation. A retired provider that needs
its plugin is shown with that prerequisite. Browser consent, device codes,
callback input and provider questions depend on the selected method. Check
sign-in refreshes its status; returning focus also refreshes. There is no
idle polling. An unavailable method is not replaced by an invented login.

Existing account discovery is also opt-in. Choose the supported entries to
add, then confirm the shared change. Unselected entries are unchanged.
Provider credentials remain with Magpie; Oddboro agent account folders stay
separate from these provider accounts.

## Pick routes

1. Create a group from ready model or group members.
2. Set its routing rule and member order. Ordered routing uses that order
   for fallback; the timeout and patience fields control waiting.
3. Pick a ready model or group for the office. A direct tool tile returns
   the office to direct access.
4. On an Odd's Settings > Model tab, choose its own Magpie route or leave
   it on the office default. The existing direct model controls remain.
5. Use Inspect recent routes to read available request metadata, provider
   attempts, failures, fallback and token counts. Inspection sends no model
   request, and missing counters are not displayed as measured zeroes.

The model and group choices come from the connected Magpie's actual catalog,
not a separate list of Pi providers. With management access, ready groups
and provider models are listed. Model-use connections list the exact
published model and routing-alias IDs without requiring a provider array or
claiming to know group settings. Saved missing routes stay visibly unavailable. For a server
connection, the inference token's authorized catalog limits the offered
routes. Changing provider visibility or token scope can therefore change
what Oddboro offers even when the server has other groups saved.

A route change applies to the next run and is refused while the affected
run is active. An unavailable route fails with a connection error rather
than silently using a different provider or the owner's global login.
Setup accepts included Pi plus a working Magpie route without a separate
CLI or direct vendor sign-in. Owners who explicitly keep Claude Code or
Codex must have their chosen runner installed and recent enough.

## Current limits

| Oddboro execution tool | Direct access       | Through Magpie      |
| ---------------------- | ------------------- | ------------------- |
| Pi (built-in)          | Unsupported         | Mac, Linux, Windows |
| Claude Code            | Mac, Linux, Windows | Mac, Linux, Windows |
| Codex                  | Mac, Linux, Windows | Mac, Linux, Windows |
| Grok                   | Mac, Linux, Windows | Unsupported         |
| Gemini                 | Not offered         | Unsupported         |

Pi reaches files through the same office file MCP server as the other
runners, plus the MCP tools granted by Oddboro. It does not expose an
arbitrary shell or built-in web search. Its thinking controls
stay hidden until qualified for its selected model. A direct Pi model is
refused.

Runner availability and command permission are separate. Current main offers
Claude Code, Codex and Grok on Mac, Linux and Windows because Oddboro carries
their file access through its shared MCP server. Command access still follows
the measured platform rules: Claude Code on Mac, Codex on Mac and Linux, and
no Grok commands. A gateway does not widen those grants. Minimum tool versions
and account-folder isolation still apply.
When the office uses Magpie, looks are built from parts and the office uses
the ready-made Main Street layout. Generated looks and office designs are
not qualified through a model alias or fallback group.

## Runtime and private state

`ODDBORO_HOME` selects the office home, normally `~/.oddboro`. Magpie's
connection settings live under `magpie/connection.json`, and built-in state
under `magpie/runtime/` within that home. The connection file holds private
management credentials when authorized, with restricted file permissions. A
keyless model-use connection stores no management credential. Do not commit or
paste it into reports. Public API responses omit credential values.

The built-in process uses the patched `--embedded` contract, private data,
separate loopback management/inference ports and fresh process keys. A
private directory alone is not its containment boundary. Startup checks
both listeners against the embedded version and instance identity. Shutdown
uses only the child handle this office created, never a saved process ID.
On office restart, a saved built-in connection starts a fresh owned process.

`npm run magpie:build` builds without running Magpie or accessing sign-ins.
It needs Git, tar and the exact local Go toolchain version recorded
in `apps/desktop/magpie/source.json`. The build checks the pinned source
archive and embedding patch, then writes the binary, license and
`magpie-runtime.json` into `apps/desktop/stage/magpie/`. The manifest records
the source commit, patch hash, binary hash, version, platform and chip.
The server refuses a missing or mismatched runtime. Desktop staging builds
and includes this directory; it is not a system-wide Magpie installation.
See [desktop packaging](../apps/desktop/CLAUDE.md) for the staging entry point.

The source pin includes a focused downstream patch for Magpie's embedding
boundary. Magpie currently accepts pull requests only from its maintainers,
so this integration does not depend on a separate upstream PR. A source
upgrade must reapply or retire the patch, update its digest, and repeat the
runtime and isolation checks. Magpie's MIT license is included beside it.

## Maintainer map

The UI presents one Magpie choice. The APIs retain separate runner and model
fields so existing offices keep their explicit tools and per-Odd overrides.
`officeConfigured` distinguishes an existing owner choice from an unconfigured
setup; only the latter defaults to bundled Pi. Pi is never saved as a direct
provider/model choice.

| Source                                                                  | Responsibility                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/office/src/lib/ui/OfficeTools.svelte` and `agent-tools.svelte.ts` | One setup flow, real runner selection and office route readiness                |
| `apps/office/src/lib/ui/MagpieSetup.svelte`                             | Native provider/group management and safe local/server connection switching     |
| `apps/office/src/routes/api/agents/+server.ts`                          | Installed bundle state, offered runners and validated office saves              |
| `apps/office/src/lib/server/pi.ts` and `pi-worker.ts`                   | Per-run Pi adapter and included worker, using the selected gateway route        |
| `packages/ledger/src/files-server.ts` and `file-walls.ts`               | Shared per-run file MCP tools and folder boundaries                             |
| `apps/office/src/lib/server/pi-worker-path.ts`                          | Worker entry on the office's Node, in development and the desktop bundle        |
| `apps/office/src/lib/server/magpie.ts`                                  | Private connection state, management actions and gateway catalog validation     |
| `packages/ledger/src/agents.ts`                                         | Platform offers, direct model catalogs and Pi's lack of direct/thinking choices |

Pi sessions stay under the office's private `pi-sessions/` folder. The worker
is included application code, not a separately installed or signed-in Pi
CLI. Its model and tool permissions come from the validated Oddboro run.

## Pi runtime notes

The worker pins `@earendil-works/pi-agent-core` and
`@earendil-works/pi-ai` to 1.5.0. It is a standalone application worker on the
same Node that runs the office; desktop uses the bundled Node. It does not
launch the Pi CLI, load global Pi configuration or extensions, or register
an implicit shell. File access uses Oddboro's shared per-run MCP file server,
not a second Pi-specific file implementation. Only the granted MCP tools enter
the model's tool list.

The gateway credential reaches the worker through its private process
environment, not arguments or run input. The worker removes it before
starting MCP clients, and excludes it from command-backed MCP environments.
Credentials for an owner-granted MCP server remain that server's own access
contract.

The shared file server and `file-walls.ts` enforce allowed folder access in
host code, including protected edits and resolved paths. This is a model-tool
capability boundary, not a kernel sandbox. A hostile process running as the
same user can race filesystem checks. This limit is distinct from refusing
model-requested shell commands or ungranted paths.

Each staff Pi run receives the same `mcp__files` server as the other runners, with
that run's working folder, read/write grants and protected edits. These file
grants decide its local edits. Bare office runs have no tools or file server.
Outside MCP tools still pass through Oddboro's
gateway: at Draft, a tool call that changes something waits for the owner's
approval on the desk. Magpie supplies models, not either kind of permission;
this integration adds no separate file-edit approval workflow.

Sessions live in the office's private `pi-sessions/` store, under a scope
that includes the Odd, execution account, Magpie source identity, gateway and
model. A session from a different scope is not resumed. Session directories
and files request private creation modes; platform file-access behavior is
part of release qualification. The gateway credential is not a session
field.

Pi reports unknown provider pricing as `costUSD:null`, not as a free request.
A reported numeric zero remains zero. The nullable-cost migration changes
the column constraint without rewriting historical costs; omitted legacy
cost fields retain their earlier zero behavior. A total containing unknown
rows is null, with a separate known subtotal and known/unknown row counts.
The token display is unchanged; these fields do not introduce a price UI.

The office build runs `apps/office/scripts/build-pi.ts` and produces
`build/pi-worker.cjs`, `build/pi-worker-licenses.json` and
`build/pi-worker-integrity.json`. The standalone worker carries its pinned
runtime dependencies and license notices. Desktop staging checks both hashes
and the required package inventory through `apps/desktop/scripts/pi-stage.ts`
before copying the office build. Missing or altered worker/notice artifacts
fail staging; a successful source build alone does not qualify a packaged
release on every platform.

Pi supplies the shared file server with an optional `noAccess` list for
private chat/session, account, runtime, settings and code paths. It applies
to reads, writes and list/find/search results. Invalid supplied walls refuse
access. Saved external folder grants are checked again before a Pi run, so
an older broad grant cannot reopen private paths. Other file-server callers
that omit `noAccess` retain their existing folder grants. The shared server
also refuses special files, such as FIFOs, before opening or searching them.

## Evidence before release

Synthetic adapter, runner and browser tests can verify routing, refusal,
isolation and the native controls without paid requests. They do not prove
real vendor consent, token renewal, subscription terms, model tool behavior,
or a packaged app's behavior on each system. Keep those limits visible in
the change's verification record.

The earlier Linux sandbox probe on the old integration base is historical
evidence for that base. It does not override current main's shared file MCP
architecture or imply that current Codex and Grok are Mac-only. Current-main
synthetic checks and physical release walkthroughs need their own receipts.

Before release, walk through setup on Mac, Linux and Windows with their
supported runners. Verify the packaged runtime, shutdown/restart, a real
supported provider sign-in or API key, and an approved request with streaming,
tools, cancellation and fallback. Record unavailable combinations explicitly.
The repository's lint, type and formatting checks must also pass.
