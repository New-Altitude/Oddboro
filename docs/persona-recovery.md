# Connect a persona without rebuilding the office

An existing conversation can keep the original persona request, offer the current New Altitude account actions, and resume the request after consent succeeds. An ordinary Odd changes to a persona only when the owner chooses that exact Odd and an offer returned by the account. A shared name proves nothing.

## Review the change

1. `packages/ledger/src/persona-requests.ts` keeps the identity requested, originating Odd, goal, work, task and continuation. `request_persona` only proposes the connection. The owner route maps it to an offered slug.
2. `apps/office/src/lib/ui/ChatPersonaRequests.svelte` shows the request in that Odd's conversation. It reuses the existing account sign-in and persona consent handlers. The card explains which instructions change and lets the owner review any obsolete tasks to withdraw.
3. `packages/ledger/src/personas.ts` converts the selected Odd in one transaction. Its ID, goal membership, chat, notes and other files stay. A revision retains the previous staff row, connector grants and project connections. Jobs pause, external grants end, and command, web and folder access start off. The owner must grant any access the persona needs.
4. `persona.ts` verifies an actual offer and persona consent before completing the request. Installation is serialized. An active run, pending follow-up or active or uncertain project dispatch prevents conversion. A persona already installed elsewhere leaves the ordinary Odd untouched; the owner can select the installed persona instead.
5. Completion and its pickup commit together. Repeated callbacks and later reconciliation cannot start another pickup. If the original work ended, the connection remains recorded and no pickup starts. Explicitly mapped old tasks are withdrawn with a reason, using the normal task-ending behavior for any other work parked on them.
6. `pending-sign-ins.ts` persists only sign-in state and its provider ID in the secret store, beside the existing PKCE verifier. Entries expire after thirty minutes and are consumed before exchanging a code. A restart or a closed browser does not lose the request. A stale callback still fails.

The manager's small capability section reads the same office-tool declarations as the tool server, plus current account and offer state. It contains no credentials. It refreshes when the manager runs. The existing outside-tool reconnect request still handles GitHub and other connectors; the new card does not replace connector sign-in.

## Checks

The database test starts with an ordinary reviewer, a same-name colleague, an existing goal, a scheduled job, a connector grant and an old task. It checks exact-ID conversion, retained membership and instructions, removed grants, paused job IDs, a single pickup, reviewed task withdrawal, cancellation and an unavailable identity.

The office test uses the real account and persona handlers against a fake New Altitude service. Consent converts one ordinary Odd, retains its earlier chat and note, permits an answered persona call, and then refuses a call after disconnect. Repeated reconciliation starts one pickup. Separate tests reopen the pending-state reader, consume a callback once and reject expired state. Prompt snapshots hold the manager's capability wording.

These tests verify the protocol and stored behavior. They do not establish that any particular real account offers an author, that the live office has been converted, or that provider consent has been given. The combined upgrade and installed-interface checks are recorded separately in the release review.
