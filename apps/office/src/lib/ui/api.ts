// Talking to the office server from the page. A failed call throws with the
// server's own message, so the page can show it as written.
//
// Every action goes as JSON, even one with no body, like a DELETE. SvelteKit
// refuses an action with no content type unless its Origin matches the
// office's, and in a release the office takes its origin to be https while
// the page is http (apps/office/CLAUDE.md, "Who the office answers").
import type { Path } from '$app/types';

/**
 * An address one of the office's own routes answers, with any search after
 * it. The type check catches a wrong address only up to its first route
 * parameter: `Path` writes a parameter as `${string}`, which matches any
 * rest, so `/api/staff/${id}/attachmentz` still passes.
 */
// The slash is added here because SvelteKit 3.1's `Path` names each route without one.
export type ApiUrl = `/${Path}` | `/${Path}?${string}`;

export async function call<T = { ok: true }>(
  url: ApiUrl,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  /** Drops the call; the office stops work it was doing for it, such as a drawing. */
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
    headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

/**
 * One file's bytes as a POST, with its name and type in headers. It goes as
 * application/octet-stream, which SvelteKit's form check never applies to,
 * whatever the file is.
 */
export async function sendFile<T>(url: ApiUrl, file: Blob, name: string, type: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      'x-media-type': type
    },
    body: file
  });
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

export async function failure(res: Response): Promise<Error> {
  const text = await res.text();
  let message = text;
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? text;
  } catch {
    // Plain text error.
  }
  return new Error(message || `HTTP ${res.status}`);
}

/**
 * A JSON POST whose answer the caller reads itself, such as the chat's event
 * stream. `keepalive` lets one sent as the page closes still arrive.
 */
export function post(url: ApiUrl, body: unknown, keepalive = false): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    keepalive,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/** A POST whose answer streams a line of JSON at a time. Each line goes to `on` as it lands. */
export async function stream<T>(url: ApiUrl, body: unknown, on: (line: T) => void): Promise<void> {
  await lines(await post(url, body), on);
}

/** Follow a GET that streams a line of JSON at a time, until it ends. */
export async function follow<T>(url: ApiUrl, on: (line: T) => void): Promise<void> {
  await lines(await fetch(url), on);
}

async function lines<T>(res: Response, on: (line: T) => void): Promise<void> {
  if (!res.ok || !res.body) throw await failure(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) on(JSON.parse(line) as T);
    }
  }
}
