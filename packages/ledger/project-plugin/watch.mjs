// A notice contains an ID, never the assignment or a permission decision.
// Claude reads the work through the MCP tool, which checks the conversation ID.
import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
const [folder, expected] = process.argv.slice(2);
if (process.env.CLAUDE_CODE_SESSION_ID && process.env.CLAUDE_CODE_SESSION_ID !== expected)
  process.exit(0);
let last = '';
let lastCorrection = '';
function changed() {
  try {
    const message = JSON.parse(readFileSync(join(folder, 'offer.json'), 'utf8'));
    if (message.id !== last) {
      last = message.id;
      process.stdout.write(
        'Office assignment ' +
          last +
          ' is ready. Use the oddboro_project take_work tool. Follow the assignment under your current project permissions. Return its answer with finish_work.\n'
      );
    }
    const correction = JSON.parse(readFileSync(join(folder, 'correction.json'), 'utf8'));
    if (correction.id === message.id && correction.key !== lastCorrection) {
      lastCorrection = correction.key;
      process.stdout.write(
        'Your current office assignment has a correction. Read it with take_correction before continuing.\n'
      );
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
const watcher = watch(folder, (_event, name) => {
  if (name === 'offer.json' || name === 'correction.json') changed();
});
watcher.on('error', () => process.exit(1));
changed();
