# Return a persona review to the same project

The owner selects a file and line range in a connected Codex or Claude conversation, sees the exact message, then sends it to an installed New Altitude persona. The full answer and its inline sources can return to that conversation as a native assignment. The original project, conversation ID and provider instructions stay in place.

## Review the change

1. `project-review-source.ts` reads a bounded UTF-8 text file inside the selected project. It keeps the source hash, line range, exact excerpt and omission count. The message must fit the service's 4,000-character limit before anything leaves. A changed file requires a new preview.
2. `project-reviews.ts` in the ledger keeps the review. The server module of the same name uses `personaRun` with the approved message and a stable consultation key. Preparation has no coding-tool actions. The ordinary persona flow still formats its own prompts.
3. `returnProjectReview` uses the existing `requestProject` transaction and queue. The answer, source excerpt and separate office recommendation stay distinct. Draft creates a proposal; Read cannot send. A revoked grant is checked again when the queue claims its assignment. A repeated return keeps one ID and cannot change its wording.
4. `ProjectReviews.svelte` belongs to the existing Projects window. A session can link to an existing goal. Goal cards read the same session and request rows for the responsible Odd, latest completed result and pending decision. No second project history is kept.

## Interruption and correction

A consultation interrupted before its answer was saved does not run again automatically. The card says that its result is unknown. Recover a saved answer reads the consultation record; it does not send another request. A known refusal or rate limit can be retried deliberately. An already saved authentic answer is reused.

Withdrawing a review also withdraws an unsent return assignment in one transaction. An assignment that has already left the office must be stopped or corrected in the native session. An uncertain native send keeps the existing session queue blocked until the owner checks it. Reconnection does not change the conversation ID.

## Checks

Run the ledger `project-reviews`, `project-sessions` and `live-tables` tests, and the office `project-review-source`, `project-review-flow` and `project-review-native` tests. They use disposable databases. The flow test calls a fake New Altitude HTTP service and checks the exact message, full answer and sources. The native test runs the real controller with a controlled Codex RPC client and Claude's real paired MCP tool server. It checks the original ID, an untouched second conversation, saved-answer recovery, native write denial and uncertain delivery. Prompt snapshots show both messages in review.

These tests do not establish a live provider login or that a paid model follows a project-only skill. The controlled clients preserve a fixture fact and use a fixture skill. Before release, repeat the documented native-project walkthrough with real signed-in clients and the chosen persona, then inspect the resulting edits in those same conversations. Codex still needs an accessible private App Server socket or the existing saved-ID handover. Claude still needs its supported plugin attachment.

Migration `0026_project_reviews` adds the review table and an optional goal link on existing sessions. It does not rewrite existing sessions, jobs, chats or grants.
