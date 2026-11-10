# Magpie and Pi: maintainer guide

Status: built on this integration branch. This guide describes the code,
not an upstream merge, published release or universal provider qualification.
For setup steps, read [Magpie model connections](magpie.md).

## Read only the path you are changing

Start with the repository rules, then choose one row. Follow a dependency
only when the change crosses its boundary. These pointers are a reading map,
not another instruction source or a second copy of the implementation.

| Change                      | Start here                                                                                                                     | Follow when needed                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Setup or onboarding         | [OfficeTools](../apps/office/src/lib/ui/OfficeTools.svelte), [AiCard](../apps/office/src/lib/ui/onboarding/AiCard.svelte)      | [AgentTools](../apps/office/src/lib/ui/agent-tools.svelte.ts), [agents API](../apps/office/src/routes/api/agents/+server.ts) |
| Connection controls         | [MagpieSetup](../apps/office/src/lib/ui/MagpieSetup.svelte)                                                                    | [connection store](../apps/office/src/lib/ui/magpie.svelte.ts), [public types](../apps/office/src/lib/magpie.ts)             |
| Model and alias choices     | [choice helpers](../apps/office/src/lib/ui/magpie-ui.ts), [per-Odd picker](../apps/office/src/lib/ui/MagpieModelPicker.svelte) | [model selection](../apps/office/src/lib/server/cli.ts), [agent catalogs](../packages/ledger/src/agents.ts)                  |
| Discovery or authorization  | [setup procedure](../apps/office/src/lib/server/magpie-setup.ts)                                                               | [discovery](../apps/office/src/lib/server/magpie-discovery.ts), [transport](../apps/office/src/lib/server/magpie-http.ts)    |
| Adapter state or an action  | [adapter](../apps/office/src/lib/server/magpie.ts)                                                                             | [owner API route](../apps/office/src/routes/api/magpie/+server.ts), public types                                             |
| Pi execution                | [Pi launch](../apps/office/src/lib/server/pi.ts), [worker](../apps/office/src/lib/server/pi-worker.ts)                         | [staff runs](../apps/office/src/lib/server/staff.ts), [office runs](../apps/office/src/lib/server/office-run.ts)             |
| File or outside-tool access | [file walls](../packages/ledger/src/file-walls.ts), [file MCP server](../packages/ledger/src/files-server.ts)                  | [outside-tool gateway](../apps/office/src/lib/server/gateway.ts), staff runs                                                 |
| Runtime ownership           | [managed process](../apps/office/src/lib/server/magpie-runtime.ts)                                                             | [embedding patch](../apps/desktop/magpie/embedded-runtime.patch), [source pin](../apps/desktop/magpie/source.json)           |
| Packaging                   | [Magpie build](../apps/desktop/scripts/magpie-runtime.ts), [Pi build](../apps/office/scripts/build-pi.ts)                      | [desktop staging](../apps/desktop/scripts/stage.ts), [Pi artifact checks](../apps/desktop/scripts/pi-stage.ts)               |
| Usage costs                 | [usage recording and totals](../packages/ledger/src/office.ts)                                                                 | [nullable-cost migration](../packages/ledger/migrations/0016_unknown-cost.sql), worker usage events                          |

## Keep runner, connection and route separate

The runner executes the Odd: included Pi, Claude Code or Codex when using
Magpie. Magpie supplies model inference and provider-account routing. A route
is a published model ID or a group alias. Choosing a route grants no tool,
folder, shell or outside-service permission.

The UI exposes one Magpie tile. New Magpie setups use included Pi without a
CLI install or login. `officeConfigured` distinguishes an existing explicit
runner choice; selecting Magpie preserves compatible Claude Code or Codex
choices. Use included Pi is a deliberate migration action.

`OFFICE_AGENT` selects the office runner. `OFFICE_MAGPIE_MODEL` stores its
gateway route. Per-Odd `staff.model` uses `magpie:<ref>`; null follows the
applicable office default. Direct models retain their tool catalogs.
`modelChoice` in the run layer resolves the effective route before launch.

Office saves can set runner and route together. In particular, leaving Pi
for direct access requires an atomic runner selection plus a null gateway
route. Clearing only Pi's route would leave an unusable direct Pi setup.
Incomplete initial Pi setup is allowed, but Next and execution need a ready
route. Active-run checks refuse changes at the API boundary.

The accepted choices and their reasons are in the existing
[office-runner decision](decisions/2026-11-05_staff_the-office-runs-on-the-tool-the-owner-picks-at-setup.md)
and [per-Odd model decision](decisions/2026-11-05_staff_the-owner-picks-each-odds-model-from-its-tools-list.md).
The [separate-authorities decision](decisions/2026-11-07_arch_magpie-model-use-and-management-are-separate-authorities.md)
records why model use does not grant management access.

## Connection control flow

1. The Magpie tile calls `setup` on demand. The fixed procedure lives in
   `magpie-setup.ts`; the browser does not scan credentials or run detection.
2. The adapter reads the saved source, performs bounded identity/catalog
   checks and returns public state. It does not send a model request.
3. The UI offers routes from that state. Selecting one saves the exact ID;
   it does not manufacture provider accounts or group membership.
4. A run resolves its route again through `magpieRunConnection`. Missing,
   unauthorized or unavailable routes fail before model execution.
5. The selected runner receives the validated inference connection. Provider
   credentials remain with Magpie; management credentials stay with the adapter.

| Starting state                                          | Result of setup or an explicit switch                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Fresh office, identified public local gateway           | Attach for model use and list its published catalog. Management is optional.                                         |
| Fresh office, no identified installation                | Start the compatible bundled runtime if available. Its providers and groups are separate.                            |
| Detected authorization requirement or uncertain service | Show a connection choice or error. Do not assume absence and start another copy.                                     |
| Saved ready connection                                  | Reuse the chosen source. Do not search for a preferred replacement.                                                  |
| Saved use-only source unavailable or empty              | Keep that source and report the problem. Do not silently switch to managed or direct access.                         |
| Saved managed source after restart                      | Start a fresh owned child with its private state and new process credentials.                                        |
| Saved HTTPS server needs authorization                  | Reconnect that server. Do not read local access descriptors or fall back to a local copy.                            |
| Explicit Use existing Magpie from managed mode          | Try the known local gateway; offer local URL retry/custom port on failure. Validate before replacing the connection. |
| Failed or canceled switch/management upgrade            | Keep the working source, saved route and catalog. Cancel sends no disconnect action.                                 |

An empty existing catalog is not permission to replace a running managed
source. After a successful switch, a saved route absent from the new catalog
stays visible as unavailable until the owner chooses another route.

There is no permanent idle polling. Refresh and focus events perform bounded
reads; supported sign-in flows have explicit status/cancel actions. A second
in-flight mutation is refused. Switching source never means silently using
the owner's direct vendor login.

## Model use and management are different permissions

`MagpieState.access` separates `use` from `manage`. Every real adapter state
sets it. UI management controls require `manage`; server checks enforce the
same boundary even if a client constructs an action itself.

| Connection                      | Model use                                   | Management                                            | Authorization                                                                                    |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Existing local, `use`           | Exact published model and routing-alias IDs | None                                                  | Keyless local inference identity and catalog checks                                              |
| Existing local, `manage`        | Validated gateway routes                    | Native provider/account/group controls and inspection | Browser access link or manual management key; inference settings can be read after authorization |
| Managed, `manage`               | Validated owned gateway                     | Embedded capability subset                            | Distinct fresh private management and inference credentials                                      |
| Explicit HTTPS server, `manage` | Catalog allowed by its inference token      | Supported authorized management API                   | Management session plus a separate required inference token                                      |

For local model use, `gatewaySnapshot` first checks `/v1` identifies Magpie,
then validates `/v1/models`. Names and `kind: 'group'` describe routing
aliases, not editable group configurations. `providers`, `groups`, `logins`
and `calls` stay empty in this view. The choice helper bypasses provider
filtering only for a ready use-only catalog. Empty catalogs are not ready.

This split avoids demanding an administrative key merely to use a gateway
that already permits local inference. Listing models is metadata evidence,
not a provider health check, successful paid request or permission to edit.

Manage connection authorizes an upgrade, not a new inference attachment.
The local upgrade checks its management settings map to the current gateway.
It must not erase usable state when credentials, mapping or readiness fail.
Provider/group edits affect the installation's other clients after upgrade;
the UI requires acknowledgment and keeps a shared-edit notice visible.

The adapter refuses management actions on `use` before making an upstream
request. This includes sign-ins, discovery and request inspection, not only
writes. Hiding controls alone is not the permission boundary.

## Transport and credentials

Local endpoints must be HTTP root origins with literal loopback addresses
and explicit ports. Alternate IP spellings, hostnames, embedded credentials,
paths and redirects cannot widen that local scope. A service that returns a
model-shaped list without Magpie identity is insufficient.

Remote connections are an explicit HTTPS mode, not keyless remote discovery.
The management and externally reachable inference root URLs can share an
origin. TLS checks stay enabled. The supported management sign-in obtains
its cookie without navigating the browser to a credential URL; inference
identity/version and token-authorized catalog checks verify the mapping.

The access link is parsed server-side as an alternative to manual URL/key
fields. Mixing those forms is rejected. Fresh local links omit blank
inference overrides so authenticated settings supply the actual port/token.
A management upgrade retains the current gateway mapping for verification.
Remote inference URL and token remain explicit and required.

UI credential fields are ephemeral password inputs. Submit, cancel,
location/input-mode changes and destruction clear entered links and keys.
They do not enter browser navigation, storage or public state. Transport
errors omit upstream response bodies. API responses use `no-store` and the
owner-page guard; they can contain private local metadata even without keys.

Literal loopback and protocol identity are not protection against a hostile
process running as the same operating-system user. Do not describe them as
cryptographic attestation of an independently running application.

## Why Pi is bundled SDK code

The worker pins `@earendil-works/pi-agent-core` and
`@earendil-works/pi-ai` to 1.5.0. The low-level SDK supplies the agent loop
and Responses streaming without a separately installed CLI, vendor login,
global Pi configuration, extension discovery or implicit shell tools.

`pi.ts` validates the run and launches the worker through `process.execPath`.
Development uses the TypeScript entry; a packaged app uses the standalone
worker on the desktop's bundled Node. Pi is an execution runner behind the
Magpie tile, not another provider selector or a general direct-model mode.

The inference credential reaches the worker through its private environment,
not arguments or stdin. The worker removes it before creating MCP clients
and strips it from command-backed MCP environments. Management and provider
credentials are not part of that worker contract.

Pi exposes only granted MCP tools. Staff runs require the real per-run office
file server and valid private walls. Bare office runs have no tools or file
server. Pi has no arbitrary shell or built-in web search. Thinking controls,
generated looks and office design remain unqualified through gateway routes;
setup uses parts and the ready-made layout.

## Files, approvals and sessions

The shared file MCP server enforces `cwd`, readable/writable roots,
protected edits and resolved paths through `file-walls.ts`. Pi also supplies
`noAccess` roots for private office state. Broad folder grants cannot expose
Magpie credentials, execution-account stores or Pi sessions through that
server. `piLaunch` refuses missing or substituted file-server configuration.

Local file grants decide file edits. Outside MCP calls go through the
existing office gateway: a changing call at Draft waits for the owner's
approval on the desk. This integration does not introduce a second file-edit
approval system or let a model route bypass the existing gateway.

These file checks are a host-enforced model-tool boundary, not a kernel
sandbox. A hostile same-user process can race filesystem checks. Keep this
limit separate from refusing model-requested shell commands or denied paths.

Pi session scope includes Odd, execution account, Magpie source identity,
gateway and selected model. A transcript from another scope is not resumed.
Sessions live in the private office store and request restrictive creation
modes. A source change can create a new session scope even if a model name
looks unchanged. The gateway credential is not a session field.

Claude Code and Codex retain their own isolated execution-account and launch
contracts. Their supported command/platform restrictions still apply; a
gateway route does not grant a shell or qualify an unsupported runner.

## Why Magpie carries a downstream patch

The ordinary app is not an owned subprocess contract. The pinned embedding
patch adds private data selection, bounded API capabilities, separate keyed
loopback listeners, a per-process instance identity and stdin-owned lifetime.
Self-update and agent-management routes are unavailable in embedded mode.
Only its advertised Codex sign-in and selected file-backed Codex discovery
are supported there; a selected shared sign-in is read, not copied or renewed.

`magpie-runtime.ts` checks the binary manifest/hash, API version, required
capabilities and matching management/inference instance identities before use.
Shutdown uses the child handle this office created, never a saved PID.
Private directories and gateway tokens do not turn that process into an
operating-system sandbox or isolate hostile same-user processes.

The source pin, archive digest, patch digest and exact Go toolchain are in
`source.json`. The build emits the binary, license and `magpie-runtime.json`.
The office build emits `pi-worker.cjs`, dependency notices and an integrity
manifest. Desktop staging verifies those hashes and required package versions.

An upstream source update must reapply or retire the patch and repeat its
contract checks. Keeping a pinned downstream patch makes those changes
reviewable without depending on a separate upstream embedding proposal.

## Unknown prices are not free requests

Pi emits `costUSD: null` when provider pricing is not reported. Reported zero
remains numeric zero. Omitted legacy costs keep their existing zero default.
The nullable-cost migration changes the constraint without rewriting history.
Totals containing unknown rows are null; known subtotal and known/unknown
row counts remain available. Do not display a partial subtotal as total cost.

## Extend one boundary at a time

1. Identify whether the change concerns runner, route, authorization or tools.
   Update the public type and central server refusal before adding a control.
2. Preserve exact catalog IDs and separate published aliases from group
   configuration. Add positive and negative identity/catalog fixtures.
3. Keep source switches explicit and validate before committing new state.
   Test failed/canceled upgrades, saved targets, empty catalogs and stale routes.
4. Grant no new file, shell or outside-tool capability as a model side effect.
   Qualify model capabilities before exposing thinking, web or drawing controls.
5. Update pins, notices and integrity checks together when dependencies change.
   Run affected tests and the required checks, then record native release limits.

## Targeted checks and release evidence

Run from the repository root with the locked dependencies installed. Select
the affected test group; these synthetic tests use temporary state and fake
services. Do not point a fixture at a real office, provider or credential store.
Use a disposable user home and an isolated network with fixture loopback
access. Preserve an ordinary, unprivileged user: root can bypass file-mode
denials and invalidate file-permission tests. Keep real provider credentials
out of the test environment.

```sh
# Choices and setup authorization
node --test --experimental-test-module-mocks apps/office/src/lib/ui/magpie-ui.test.ts apps/office/src/lib/server/magpie-setup.test.ts apps/office/src/lib/server/magpie-access-link.test.ts
# Adapter identity, inference-only access and transport
node --test --experimental-test-module-mocks apps/office/src/lib/server/magpie.test.ts apps/office/src/lib/server/magpie-gateway.test.ts apps/office/src/lib/server/magpie-server.test.ts
# Real SDK against a fake gateway, launch and cancellation
node --test --experimental-test-module-mocks apps/office/src/lib/server/pi.test.ts apps/office/src/lib/server/pi-worker.test.ts apps/office/src/lib/server/pi-stop.test.ts
# Shared file boundary and unknown usage cost
node --test --experimental-test-module-mocks packages/ledger/test/pi-file-private.test.ts packages/ledger/test/usage-cost.test.ts
# Artifact checks without starting real runtimes
node --test --experimental-test-module-mocks apps/desktop/scripts/magpie-runtime.test.ts apps/desktop/scripts/pi-stage.test.ts
```

Routes and staff integration have additional tests such as
`magpie-route.test.ts`, `magpie-run.test.ts` and `staff-run.test.ts`; use the
office test script's module-mocking flag when running those groups. Required
repository checks remain `npm run lint`, `npm run check-types` and
`npm run format:check`, plus affected builds and suites.

For rendered behavior, mount the real Svelte controls against an intercepted
synthetic API. Cover all three platform offer shapes and mobile width:
one-click model use, exact alias selection, preserved explicit runner,
optional management, failed switches and explicit separate built-in fallback.
Synthetic platform data is not a native operating-system walkthrough.

Before release, verify packaged startup/restart/shutdown on Mac, Linux and
Windows. Separately qualify real supported sign-in, streaming, tools,
cancellation, fallback and provider policy with approved accounts and requests.
Source tests or one successful installation do not prove every vendor,
native platform, model capability or packaged release combination.
