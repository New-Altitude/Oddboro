// The proof that an address is this office, answered without the owner's key
// (`office-proof.ts` in the ledger). A caller sends a fresh nonce and checks
// the answer against the key it holds, so it never sends the key to a
// listener that is not the office. It answers in the app too: the shell
// proves its office before it opens a page with the key.
import { answerProof, NONCE_PARAM, PROXY_HEADER } from '@oddboro/ledger/office-proof';
import { ownerKey } from '@oddboro/ledger/owner-key';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, request }) => {
  const { status, body } = answerProof(
    ownerKey(),
    url.searchParams.get(NONCE_PARAM),
    request.headers.get(PROXY_HEADER)
  );
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
};
