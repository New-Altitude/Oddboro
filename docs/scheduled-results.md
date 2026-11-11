# Require a reviewed result from existing jobs

A daily result requirement joins an existing producer and reviewer. It keeps their IDs, schedules, instructions and history. The owner chooses the responsible Odd, daily deadline, time zone, destination and allowance of zero to two recovery runs. Configure it in the producer's Jobs editor. The goal shows the same editions.

## Review the change

1. `packages/ledger/src/scheduled-results.ts` stores the requirement and one edition per requirement and local date. Each edition freezes its destination and keeps its producer run, reviewer run, file digest, exact delivery message, Desk report and provider receipt separately. Migration 0027 adds two tables; it does not change existing jobs.
2. `apps/office/src/lib/server/scheduled-results.ts` reads the file evidence from the existing run records. The reviewer must have read that edition's successful producer run. Before delivery, the existing file and source-access checks run again and the current file must match the reviewed digest. A missing or oversized file stops delivery. No text is silently cut.
3. `jobs.ts` calls reconciliation from its existing clock and completed runs. Recovery claims its allowance and run in one transaction, then uses the existing job runner. It starts no second timer. A running producer or reviewer is allowed to finish. A failed review of unchanged producer bytes gets at most one repair review. Other failures consume no more than the chosen allowance.
4. One current incident report names the responsible Odd, repair already attempted, next action and last verified output. The existing reconnect task is reused. Normal run history remains. A requirement suppresses its jobs' separate report cards while enabled so a recurring failure does not fill the Desk.
5. `scheduled-delivery.ts` owns dispatch and reconciliation. `google/gmail.ts` reuses the current Gmail adapter with a stable Message-ID for this edition. Claiming a send happens before the network call. An interrupted claim, network failure or server failure is uncertain. Two bounded Sent-mail searches may confirm acceptance. An empty search never authorizes another send. Only an explicit rate rejection permits one automatic retry.

The body shown under **Exact reviewed message** is the body submitted to Gmail. A Gmail message ID establishes service acceptance, not arrival at the recipient. The Desk has its own timestamp. A late result never changes its deadline. Earlier missed editions remain missed. The message preserves observed clock gaps and does not describe catch-up research as continuous historical coverage.

## Authority and changes

The destination is typed by the owner; produced text cannot change it. Automatic Gmail delivery requires the responsible Odd at Act with current Gmail write access. At Draft, that Odd needs the owner's approval of the exact edition and destination. Read cannot send, including with an older approval. The claim rechecks the plan, jobs and grant. An uncertain send is never changed back to ready automatically.

Changing a job or requirement holds an unsent current edition for inspection. The next date uses the new settings. Pausing a requirement leaves its original job timers unchanged. To stop those jobs too, pause them in Jobs. This version sends plain text editions through an existing Gmail connector or makes them available on the Desk. It adds no provider or file store.

A daily requirement expects an edition every calendar day. Match the two job schedules to that promise. Saving the requirement does not run or rewrite those jobs immediately. A job's ordinary scheduled run remains distinct from a bounded `recovery` run and an owner's `manual` run.

## Check it

The controlled-service tests cover current bytes, stale output, a failed producer, slow review, revoked grants, exact approval at Draft, refusal at Read, bounded recovery, unchanged review loops, a restart during delivery, duplicate checks, timeout after service acceptance, a rate rejection, reconnect reuse, daylight saving time, missed editions and retained runtime gaps. The existing real-clock file test runs producer and reviewer through the actual file server, then submits one edition to a controlled Gmail response. No test sends mail to a real account.

Before release, run the chosen existing newsroom pair in the upgraded office for seven consecutive deadlines. Record the build, edition date, saved and reviewed file digest, deadline, Desk time, provider receipt and actual arrival at the chosen destination. Those seven mornings and recipient arrival remain release checks. Fixtures cannot establish them.

Gmail's documented contracts: [send returns a Message](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send); [list supports an RFC 822 message ID query and label filters](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list). The office treats absence from that search as inconclusive.
