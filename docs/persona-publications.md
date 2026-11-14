# Publication updates

An installed persona can announce new articles and videos in its chat. In the chat header, choose Off, In chat, or In chat and desktop. Off is the default. Discuss adds the title, link and source ID to an editable question. Only Send starts a chat turn. Updates require the office service to be running; a returning office catches up from the last saved position.

## Members service contract, version 1

A listed persona opts into this protocol with `publications: 1` on its `/api/personas/odds` entry. A missing or unknown version offers no subscription. The office never contacts a creator-supplied feed URL. It uses its configured members site, the account's `personas` bearer, and refuses redirects. The service must authorize this resource and each requested slug for the current account, including on an already open connection.

- `GET /api/personas/publications?head=1` returns `{"through":42}`. The number is a nonnegative safe integer in a single increasing sequence. The service assigns it when it commits a publication event. First enable starts after this head, with no archive announcements. A corpus backfill never emits a new publication.
- `GET /api/personas/publications/events?after=42&slug=pat` is one `text/event-stream` connection per office. Repeat `slug` for multiple subscriptions. Return committed events after the position, oldest first, as bounded `publications` events. Then continue live on the same ordered stream. The service may skip sequences for unrelated creators but must not advance `through` beyond unreturned eligible events. Use TLS in production.
- Each SSE event has a JSON `data` field with `phase` (`catch-up` or `live`), `through`, and up to 100 `events`. Emit an empty `live` batch at the end of historical replay so the office can deliver one catch-up notification. Keep an idle connection open without writing empty change events. End the connection on auth expiry or entitlement change and recheck on reconnect. Respond with 401 or 403 for lost access and 410 for an expired position. The owner can explicitly start again from now after a 410.

Example of one decoded `data` payload:

```json
{
  "phase": "live",
  "through": 43,
  "events": [
    {
      "sequence": 43,
      "slug": "pat",
      "id": "post-17",
      "revision": 1,
      "action": "published",
      "kind": "article",
      "title": "When to ask for a second opinion",
      "url": "https://example.org/post-17",
      "publishedAt": "2026-01-15T09:00:00Z"
    }
  ]
}
```

IDs are stable within a creator, across source imports and changes of title. `kind` is `article` or `video`. Each item has an increasing positive integer `revision`. A `corrected` or `withdrawn` event carries the same ID and complete public metadata. Neither produces a second alert. The service emits only already-released material and only metadata the account may see; the original site still controls access to the content. Text is plain, titles are at most 300 characters, and links are HTTPS with no embedded credentials. No article body, transcript, image or player is loaded by the office.

Each local follow stores its position. The shared connection resumes from the oldest followed position; each follow independently ignores what it has already committed. Receipt and position commit in the same transaction. Chat renders the receipt directly. Native notifications are best effort after commit, never retried; crash recovery preserves the card and does not promise an operating-system alert was shown. Quiet or removed personas lose the follow, and a new account does not inherit it. Previously received cards stay in local office history.
