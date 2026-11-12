// A reporter for Node's test runner. CI adds it beside spec through
// NODE_OPTIONS, and test-summary.ts reads what it writes. It writes one JSON
// line as each test file starts and ends and as each top-level test finishes,
// so a step killed for hanging still shows which files never ended. The
// built-in junit reporter writes only once the whole run ends, so a killed
// step leaves it empty.
import { relative } from 'node:path';
import type { TestEvent } from 'node:test/reporters';
import { ROOT } from './lib/files.ts';

const where = (file: string) => relative(ROOT, file).replaceAll('\\', '/');
const seconds = (ms: number) => Math.round(ms) / 1000;

export default async function* testTimes(source: AsyncIterable<TestEvent>) {
  for await (const event of source) {
    if (event.type === 'test:summary') {
      // The summary of the whole run is the one that names no file.
      if (event.data.file === undefined)
        yield JSON.stringify({ done: seconds(event.data.duration_ms) }) + '\n';
      continue;
    }
    if (event.type !== 'test:dequeue' && event.type !== 'test:complete') continue;
    const { file, nesting, name } = event.data;
    if (file === undefined || nesting !== 0) continue;
    // The runner wraps each file in a test of its own. Node marks every event
    // from inside a file with entryFile, and the wrapper's own events without.
    const wrapper = !('entryFile' in event.data);
    if (event.type === 'test:dequeue') {
      if (wrapper) yield JSON.stringify({ start: where(file) }) + '\n';
    } else {
      const s = seconds(event.data.details.duration_ms);
      yield JSON.stringify(
        wrapper ? { end: where(file), seconds: s } : { test: name, file: where(file), seconds: s }
      ) + '\n';
    }
  }
}
