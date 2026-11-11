---
name: oddboro-handoff
description: Bring the owner's selected work from this Codex chat into their Oddboro Office Manager's chat. Use when the owner asks for the handoff.
---

Use the current conversation. Include only the text and individual files the owner chose. Preserve their exact wording, whitespace and file bytes. If the selection is unclear, ask which part they want. Never search Codex history.

Run the prepare script beside this file with Node 24 (`node prepare.ts` in a checkout, `node prepare.js` in the desktop distribution). Pass each selected file as a separate literal path argument. Send one JSON object on stdin:

- `key` is a short stable name such as `garden-brief`. Reuse it for later versions of this selection in the same chat.
- `title` is what the owner will recognize in chat.
- `text` is the exact selected passage.
- `notes` holds the decisions, open questions and next action already agreed, or an empty string. Keep unresolved questions open.

Use Markdown or UTF-8 text files and PNG, JPEG or WebP screenshots. The selection and notes count toward the eight files and 8 MiB in a chat turn.

Encode the JSON with a serializer. Keep the contents out of command arguments and shell expansion. The script reads the current chat ID from `CODEX_THREAD_ID`. For an office with a custom home or port, use its `ODDBORO_HOME` and `ODDBORO_PORT`.

Open the printed loopback link in the owner's browser, or give them the clickable link if you cannot open it. The office must be running. The owner sees the receiving chat and accepts the selection there. Preparing a link alone has not imported it.
