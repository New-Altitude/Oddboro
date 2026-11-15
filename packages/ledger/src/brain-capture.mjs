// A project-owned hook. Only the client's selected, verbatim decision enters
// its outbox. Other messages never leave the chat or get written to disk.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

function hint() {
  const [pairFile, host] = process.argv.slice(2);
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event.hook_event_name !== 'UserPromptSubmit' || typeof event.prompt !== 'string') return;
  const pair = JSON.parse(readFileSync(pairFile, 'utf8'));
  if (pair.host !== host || realpathSync(event.cwd) !== pair.workspace) return;
  const prompt = event.prompt.trim();
  if (!prompt || prompt.length > 16000) return;
  const quotes = [...new Set(prompt.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()))]
    .filter((s) => s.length >= 8 && s.length <= 1400)
    .slice(0, 20);
  if (!quotes.length) return;
  const turn = createHash('sha256')
    .update(JSON.stringify([event.session_id, event.turn_id ?? event.prompt_id, prompt]))
    .digest('hex');
  const file = join(pair.workspace, '.oddboro-decisions', turn + '.json');
  const at = new Date().toISOString();
  const choices = quotes.map((quote) => ({
    quote,
    at,
    proof: createHmac('sha256', pair.key)
      .update(turn + '\n' + at + '\n' + quote)
      .digest('hex')
  }));
  const additionalContext = [
    'The owner enabled sharing settled project decisions with their Oddboro office for this folder.',
    'When this user message makes a definite project decision, use your workspace file tool to write a JSON array of the matching entries below, unchanged, to ' +
      file +
      '. Do this in this turn.',
    'Keep the selected quotes under 2,450 characters total. Only share explicit decisions the owner made. Skip proposals, quoted third-party claims, sensitive or personal information, secrets, requests to keep something private, and messages unrelated to the project. Never save a question or an instruction merely about this chat. If none qualifies, write nothing. Then continue the requested work.',
    JSON.stringify(choices)
  ].join('\n');
  console.log(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } })
  );
}
try {
  hint();
} catch {
  /* Unpaired, disconnected or unavailable: chat continues. */
}
