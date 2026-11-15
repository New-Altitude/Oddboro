// Open Brain positions sort by UTC creation time (six fractional digits), then UUID.
const POSITION =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
type Capture = { position: string; text?: string; hash?: string; date?: string };
type PageRequest = { order: 'asc' | 'desc'; limit: number; cursor?: string };
export type ReadPage = (request: PageRequest) => Promise<string>;

async function page(read: ReadPage, order: PageRequest['order'], cursor?: string, limit = 100) {
  const request = cursor ? { order, cursor, limit } : { order, limit };
  const data = JSON.parse(await read(request));
  if (!Array.isArray(data?.records) || data.records.length > limit)
    throw new Error('Open Brain returned an unreadable capture page.');
  let prior = cursor;
  for (const row of data.records) {
    if (
      typeof row?.position !== 'string' ||
      !POSITION.test(row.position) ||
      (prior && (order === 'asc' ? row.position <= prior : row.position >= prior)) ||
      ((row.text !== undefined || row.hash !== undefined || row.date !== undefined) &&
        (typeof row.text !== 'string' ||
          typeof row.hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.hash) ||
          typeof row.date !== 'string'))
    )
      throw new Error('Open Brain returned an invalid capture or an out-of-order position.');
    prior = row.position;
  }
  return data.records as Capture[];
}

export async function newestCapture(read: ReadPage) {
  return (await page(read, 'desc', undefined, 1))[0]?.position ?? null;
}

async function legacyStart(read: ReadPage, hashes: string[]) {
  const known = new Set(hashes);
  let before: string | undefined;
  let matchedTime: string | undefined;
  while (known.size) {
    const rows = await page(read, 'desc', before);
    if (!rows.length) break;
    for (const row of rows) {
      const time = row.position.split('/')[0];
      // The old list didn't break ties by ID. Replay the whole matching timestamp.
      if (matchedTime && time !== matchedTime) return row.position;
      if (row.hash && known.has(row.hash)) matchedTime = time;
      before = row.position;
    }
  }
  return null;
}

export async function* capturePages(read: ReadPage, saved?: string | null, legacy: string[] = []) {
  const through = await newestCapture(read);
  let position = saved === undefined ? await legacyStart(read, legacy) : saved;
  if (!through || (position && position >= through)) {
    yield { records: [], position, done: true };
    return;
  }
  for (;;) {
    const rows = await page(read, 'asc', position ?? undefined);
    const records = rows.filter((row) => row.position <= through);
    const last = rows.at(-1);
    const done = !last || last.position >= through;
    // If the captured high-water record was deleted, an empty page or a newer
    // row still proves that the interval up to it has been exhausted.
    position = done ? through : last.position;
    yield { records, position, done };
    if (done) return;
  }
}
