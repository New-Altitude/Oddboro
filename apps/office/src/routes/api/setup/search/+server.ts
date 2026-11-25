// The search model, which Setup's ledger search line downloads when the owner
// clicks Download. POST downloads it and answers a line of JSON at a time
// (`SearchLine`): how far it has got at its start and each new megabyte, then
// the line as it stands once every file matches its pinned SHA-256, or why it
// stopped. Then the office makes every ledger row's vector again in the
// background. A page that goes away leaves the download running.
import { reindexLedger } from '@oddboro/ledger';
import { checkSearch, type Check, type SearchLine } from '@oddboro/ledger/checks';
import { forgetModel } from '@oddboro/ledger/embed';
import { downloadModel, watchDownload } from '@oddboro/ledger/search-model';
import type { RequestHandler } from './$types';

async function download(): Promise<Check> {
  await downloadModel();
  forgetModel();
  const check = await checkSearch();
  if (check.state === 'ok')
    void reindexLedger().catch((e: unknown) =>
      console.error('office: the ledger re-index stopped:', e)
    );
  return check;
}

export const POST: RequestHandler = () => {
  const encoder = new TextEncoder();
  let open = true;
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      const send = (line: SearchLine) => {
        if (open) out.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      };
      stop = watchDownload(send);
      void download()
        .then(
          (check) => send({ check }),
          (e: unknown) => send({ problem: e instanceof Error ? e.message : String(e) })
        )
        .finally(() => {
          stop();
          if (open) out.close();
          open = false;
        });
    },
    cancel() {
      open = false;
      stop();
    }
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
};
