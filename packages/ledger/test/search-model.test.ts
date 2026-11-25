// Downloading the search model, with the network stood in for: every file
// checked against its pin, and nothing half-written when anything goes wrong.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  downloadModel,
  type FetchUrl,
  MODEL_FILES,
  MODEL_MB,
  modelDir,
  partialDownloads,
  RELEASE,
  removeModel,
  watchDownload,
  type DownloadProgress,
  type ModelFile
} from '../src/search-model.ts';
import { standInFiles } from './stand-in-model.ts';

const { files, contents } = standInFiles();
const FILE_HOST = 'https://release-assets.githubusercontent.com/github-production-release-asset/';

/**
 * The network as GitHub runs it: the release answers each file with a
 * redirect to its file host, which sends the file as `send` says. Every URL
 * asked for lands in `asked`.
 */
const serve = (
  send: (f: ModelFile) => Response | Promise<Response> = (f) =>
    new Response(new Uint8Array(contents[f.name])),
  redirect: (f: ModelFile) => string = (f) => FILE_HOST + f.asset,
  asked: string[] = []
): FetchUrl => {
  return async (url, init) => {
    asked.push(url.href);
    assert.equal(init.redirect, 'manual', 'the office follows each redirect itself');
    for (const f of files) {
      if (url.href === RELEASE + f.asset)
        return new Response(null, { status: 302, headers: { location: redirect(f) } });
      if (url.href === FILE_HOST + f.asset) return send(f);
    }
    return new Response('', { status: 404 });
  };
};
const nothingKept = () => {
  assert.ok(!existsSync(modelDir()), 'no model');
  assert.deepEqual(partialDownloads(), [], 'and no part of one');
};

test('Setup says about 140 MB, and the real files come from our release, each pinned to a checksum', () => {
  assert.equal(MODEL_MB, 140);
  assert.equal(RELEASE, 'https://github.com/New-Altitude/Oddboro/releases/download/models-v1/');
  assert.deepEqual(
    MODEL_FILES.map((f) => f.asset),
    ['nomic-embed-text-v1.5-int8.onnx', 'nomic-embed-text-v1.5-vocab.txt']
  );
  for (const f of MODEL_FILES) assert.match(f.sha256, /^[0-9a-f]{64}$/);
});

test('a file that does not match its checksum keeps nothing', async () => {
  await assert.rejects(
    downloadModel(
      files,
      serve((f) => {
        const b = Buffer.from(contents[f.name]);
        b[0] ^= 1;
        return new Response(new Uint8Array(b));
      })
    ),
    /did not match its checksum/
  );
  nothingKept();
});

test('a download that stops partway keeps nothing', async () => {
  const broken = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(contents['model_int8.onnx'].subarray(0, 100)));
      c.error(new Error('connection reset'));
    }
  });
  await assert.rejects(
    downloadModel(
      files,
      serve(() => new Response(broken))
    ),
    /partway/
  );
  nothingKept();
});

test('a file longer than its pin keeps nothing', async () => {
  await assert.rejects(
    downloadModel(
      files,
      serve(
        (f) => new Response(new Uint8Array(Buffer.concat([contents[f.name], contents[f.name]])))
      )
    ),
    /did not match its checksum/
  );
  nothingKept();
});

test('no network, or no file, says so and keeps nothing', async () => {
  await assert.rejects(
    downloadModel(files, () => Promise.reject(new TypeError('fetch failed'))),
    /could not reach GitHub/
  );
  await assert.rejects(
    downloadModel(
      files,
      serve(() => new Response('', { status: 404 }))
    ),
    /did not send/
  );
  nothingKept();
});

test('a good download lands whole, and a failed one after leaves it as it was', async () => {
  const asked: string[] = [];
  await downloadModel(files, serve(undefined, undefined, asked));
  assert.deepEqual(
    asked,
    files.flatMap((f) => [RELEASE + f.asset, FILE_HOST + f.asset])
  );
  for (const f of files) assert.deepEqual(readFileSync(join(modelDir(), f.name)), contents[f.name]);
  assert.deepEqual(partialDownloads(), []);
  await assert.rejects(
    downloadModel(
      files,
      serve(() => new Response('', { status: 500 }))
    )
  );
  for (const f of files) assert.deepEqual(readFileSync(join(modelDir(), f.name)), contents[f.name]);
  assert.deepEqual(partialDownloads(), []);
});

test('two clicks at once make one download', async () => {
  let asked = 0;
  const once = serve((f) => {
    asked++;
    return new Response(new Uint8Array(contents[f.name]));
  });
  await Promise.all([downloadModel(files, once), downloadModel(files, once)]);
  assert.equal(asked, files.length);
});

test('the download says how far it has got: at its start, each new megabyte, and the end', async () => {
  // Two files over three megabytes together, sent 64 KB at a time as a network does.
  const big = [2_500_000, 700_000].map((size, i) => {
    const body = Buffer.alloc(size, i + 1);
    const file: ModelFile = {
      name: `part-${i}`,
      asset: `part-${i}.bin`,
      bytes: size,
      sha256: createHash('sha256').update(body).digest('hex')
    };
    return { file, body };
  });
  const send: FetchUrl = async (url) => {
    const part = big.find((p) => url.href === RELEASE + p.file.asset);
    if (!part) return new Response('', { status: 404 });
    const chunks: Buffer[] = [];
    for (let at = 0; at < part.body.length; at += 65_536)
      chunks.push(part.body.subarray(at, at + 65_536));
    return new Response(
      new ReadableStream({
        start(out) {
          for (const c of chunks) out.enqueue(new Uint8Array(c));
          out.close();
        }
      })
    );
  };
  const heard: DownloadProgress[] = [];
  const stop = watchDownload((p) => heard.push(p));
  try {
    await downloadModel(
      big.map((p) => p.file),
      send
    );
  } finally {
    stop();
  }
  // One report at the start, one in each new megabyte, and one at the very end.
  assert.deepEqual(
    heard.map((p) => Math.floor(p.got / 1_000_000)),
    [0, 1, 2, 3, 3]
  );
  assert.equal(heard.at(-1)?.got, 3_200_000);
  assert.ok(heard.every((p, i) => p.of === 3_200_000 && (i === 0 || p.got > heard[i - 1].got)));
  removeModel();
});

test('a redirect away from GitHub is refused and keeps nothing', async () => {
  removeModel();
  for (const to of [
    'https://example.com/model_int8.onnx',
    'http://release-assets.githubusercontent.com/model_int8.onnx',
    'https://release-assets.githubusercontent.com.example.com/model_int8.onnx'
  ]) {
    const asked: string[] = [];
    await assert.rejects(
      downloadModel(
        files,
        serve(undefined, () => to, asked)
      ),
      /somewhere other than GitHub/
    );
    assert.deepEqual(asked, [RELEASE + files[0].asset], 'nothing is asked of the other host');
    nothingKept();
  }
});

test('a redirect that never ends is refused and keeps nothing', async () => {
  removeModel();
  const loop: FetchUrl = async (url) =>
    new Response(null, { status: 302, headers: { location: url.href } });
  await assert.rejects(downloadModel(files, loop), /too many times/);
  nothingKept();
});
