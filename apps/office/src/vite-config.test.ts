// The dev server launches no editor for any page: Vite's own dev server with
// the office's plugin, in a throwaway folder. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import config, { buildOptions, noEditorLaunch } from '../vite.config.ts';

const folder = mkdtempSync(join(tmpdir(), 'oddboro-vite-'));
const launched = join(folder, 'launched.log');
// Should the refusal ever break, Vite launches this stub, which only logs, and
// never an editor of the owner's (Vite takes LAUNCH_EDITOR before guessing one).
const editor = join(folder, 'editor.sh');
writeFileSync(editor, `#!/bin/sh\necho "$@" >> '${launched}'\n`);
chmodSync(editor, 0o755);
process.env.LAUNCH_EDITOR = editor;
const target = join(folder, 'secret.txt');
writeFileSync(target, 'secret');

const vite = await createServer({
  configFile: false,
  root: folder,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, watch: null },
  plugins: [noEditorLaunch()]
});
const http = createHttpServer(vite.middlewares);
const port = await new Promise<number>((done) =>
  http.listen(0, '127.0.0.1', () => done((http.address() as { port: number }).port))
);

after(async () => {
  await new Promise((done) => http.close(done));
  await vite.close();
  rmSync(folder, { recursive: true, force: true });
});

test("the office's dev config refuses the editor route before any other plugin", () => {
  const { plugins } = config({ command: 'serve', mode: 'development' });
  assert.equal((plugins?.[0] as { name?: string }).name, noEditorLaunch().name);
});

test('the Sentry build plugin never reports the build and uploads only with a token', () => {
  const without = buildOptions({});
  const withToken = buildOptions({ SENTRY_AUTH_TOKEN: 'x' });
  for (const options of [without, withToken]) {
    assert.equal(options.telemetry, false);
    assert.equal(options.release.inject, false);
  }
  assert.equal(without.autoUploadSourceMaps, false);
  assert.equal(withToken.autoUploadSourceMaps, true);
});

test('a page asking the dev server to open a file in an editor is refused, and no editor starts', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/__open-in-editor?file=${target}`, {
    headers: { 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(res.status, 403);
  assert.equal(await res.text(), 'The office opens no editor');
  assert.equal(existsSync(launched), false);
});
