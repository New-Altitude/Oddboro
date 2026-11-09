// The office's file tools: the only way an Odd reads or changes a file while
// the office carries its files. One per run, over stdio, started with the
// run's folders in ODDBORO_FILES (file-walls.ts), and nothing else: no
// database, no secrets, so it starts at once. Every path goes through
// `resolveIn` before anything opens it, so what an Odd reaches is decided
// here, the same way on a Mac, Linux and Windows, whichever coding tool asked.
//
//   ODDBORO_FILES='{"cwd":…,"reads":[…],"writes":[…],"noWrite":[…]}' node packages/ledger/src/files-server.ts
import {
  type Dirent,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  closeSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findOddboroCheckouts } from './oddboro-source.ts';
import { resolveIn, wallsFromEnv, type FileWalls } from './file-walls.ts';

/** The most a read shows by default, and the longest line it shows whole. */
const READ_LINES = 2000;
const LINE_CHARS = 2000;
/** The most text one read or search sends back, so a file of long lines pages on instead. */
const MAX_OUT = 100_000;
/** A file bigger than this is never read whole; a search skips it. */
const MAX_READ = 20_000_000;
const MAX_SEARCH_FILE = 2_000_000;
const MAX_LIST = 1000;
const MAX_FIND = 500;
const MAX_MATCHES = 200;
/** Pictures read_file shows as pictures, by extension, up to MAX_IMAGE bytes. */
const IMAGES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};
const MAX_IMAGE = 5_000_000;
/** Folders a walk never enters: the repository's own store, which no one reads as files. */
const SKIP = new Set(['.git']);

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Text = { content: Content[]; isError?: boolean };
const ok = (text: string): Text => ({ content: [{ type: 'text', text }] });
const no = (text: string): Text => ({ content: [{ type: 'text', text }], isError: true });

/** Whether a file looks like text: no NUL in its first 8 KB. */
function isText(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return !buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

/** A glob (`*`, `**`, `?`, `{a,b}`) as a regular expression over `/`-separated paths. */
export function globRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` is any number of folders, none included.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(',')
          .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
          .join('|')})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Every file under `root`, depth first, as paths relative to it with `/`.
 * Never follows a link to a folder, so a walk cannot leave the folder it
 * started in; a linked file is listed, and reading it goes through the walls.
 */
function* walk(root: string, rel = ''): Generator<{ rel: string; link: boolean }> {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) yield* walk(root, r);
    } else yield { rel: r, link: e.isSymbolicLink() };
  }
}

/** How a path reads back to the Odd: relative to its folder when inside it. */
function shown(walls: FileWalls, path: string): string {
  const rel = relative(walls.cwd, path);
  return rel && !rel.startsWith('..') && !rel.includes(`..${sep}`) ? rel : path;
}

export function fileServer(walls: FileWalls): McpServer {
  const server = new McpServer({ name: 'files', version: '1.0.0' });
  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Text
  ) =>
    server.registerTool(name, { description, inputSchema: z.strictObject(inputSchema) }, ((
      args: z.infer<z.ZodObject<Shape>>
    ) => {
      try {
        return run(args);
      } catch (e) {
        return no(e instanceof Error ? e.message : String(e));
      }
    }) as never);
  const folder = (path: string | undefined) => resolveIn(walls, path ?? '.', 'read');

  tool(
    'read_file',
    `Read a text file, or see a picture (png, jpg, gif, webp). Lines come numbered, from 1. A long file shows its first ${READ_LINES} lines: pass offset (the first line to show) and limit (how many) for the rest. Paths are relative to your folder, or absolute.`,
    {
      path: z.string(),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional()
    },
    ({ path, offset = 1, limit = READ_LINES }) => {
      const r = resolveIn(walls, path, 'read');
      if ('refused' in r) return no(r.refused);
      const st = statSync(r.path);
      if (st.isDirectory()) return no(`${path} is a folder. Use list_files.`);
      const image = IMAGES[r.path.split('.').at(-1)?.toLowerCase() ?? ''];
      if (image) {
        if (st.size > MAX_IMAGE)
          return no(`${path} is a picture of ${st.size} bytes, too big to show.`);
        return {
          content: [
            { type: 'image', data: readFileSync(r.path).toString('base64'), mimeType: image }
          ]
        };
      }
      if (st.size > MAX_READ) return no(`${path} is ${st.size} bytes, too big to read.`);
      if (!isText(r.path)) return no(`${path} is not a text file (${st.size} bytes).`);
      const lines = readFileSync(r.path, 'utf8').split(/\r?\n/);
      if (lines.length > 1 && lines.at(-1) === '') lines.pop();
      if (!lines.length || (lines.length === 1 && lines[0] === '')) return ok(`${path} is empty.`);
      const from = offset - 1;
      const slice: string[] = [];
      let size = 0;
      for (const l of lines.slice(from, from + limit)) {
        size += Math.min(l.length, LINE_CHARS) + 8;
        if (slice.length && size > MAX_OUT) break;
        slice.push(l);
      }
      if (!slice.length) return no(`${path} has ${lines.length} lines.`);
      const width = String(from + slice.length).length;
      const body = slice
        .map((l, i) => {
          const line = l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}… (line cut)` : l;
          return `${String(from + i + 1).padStart(width)}\t${line}`;
        })
        .join('\n');
      const more =
        from + slice.length < lines.length
          ? `\n(${lines.length - from - slice.length} more lines: read on with offset ${from + slice.length + 1}.)`
          : '';
      return ok(body + more);
    }
  );

  tool(
    'list_files',
    `List what is in a folder: folders end in /. Defaults to your own folder. Shows at most ${MAX_LIST} names.`,
    { path: z.string().optional() },
    ({ path }) => {
      const r = folder(path);
      if ('refused' in r) return no(r.refused);
      if (!statSync(r.path).isDirectory()) return no(`${path} is a file. Use read_file.`);
      const names = readdirSync(r.path, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => a.localeCompare(b));
      if (!names.length) return ok(`${path ?? 'Your folder'} is empty.`);
      const cut = names.length > MAX_LIST ? `\n(${names.length - MAX_LIST} more not shown.)` : '';
      return ok(names.slice(0, MAX_LIST).join('\n') + cut);
    }
  );

  tool(
    'find_oddboro_source',
    'Find local Oddboro source checkouts in a folder you can already read. Defaults to your own folder. A match identifies the source tree, not its Git remote, branch or release.',
    { path: z.string().optional() },
    ({ path }) => {
      const r = folder(path);
      if ('refused' in r) return no(r.refused);
      if (!statSync(r.path).isDirectory()) return no('Choose a folder to search.');
      const { checkouts, partial } = findOddboroCheckouts(r.path);
      return ok(
        [
          ...checkouts,
          ...(!checkouts.length ? ['No Oddboro checkout found here.'] : []),
          ...(partial ? ['Some folders were not searched. You can search a narrower folder.'] : [])
        ].join('\n')
      );
    }
  );

  tool(
    'find_files',
    `Find files by name with a glob, like "**/*.md" or "notes/*.{txt,md}", in a folder (your own by default), searching every folder in it. Shows at most ${MAX_FIND}.`,
    { pattern: z.string(), path: z.string().optional() },
    ({ pattern, path }) => {
      const r = folder(path);
      if ('refused' in r) return no(r.refused);
      const re = globRegex(pattern.replace(/^\.\//, ''));
      const found: string[] = [];
      for (const { rel: f } of walk(r.path)) {
        if (re.test(f) || (!pattern.includes('/') && re.test(f.split('/').at(-1)!))) {
          found.push(shown(walls, join(r.path, f)));
          if (found.length > MAX_FIND) break;
        }
      }
      if (!found.length) return ok(`No file matches ${pattern}.`);
      const cut = found.length > MAX_FIND ? `\n(More not shown: narrow the pattern.)` : '';
      return ok(found.slice(0, MAX_FIND).join('\n') + cut);
    }
  );

  tool(
    'search_files',
    `Search the text of files for a regular expression (JavaScript syntax), in a folder (your own by default) or one file. glob narrows which files, like "*.md". Shows file:line: text, at most ${MAX_MATCHES} matches.`,
    {
      pattern: z.string(),
      path: z.string().optional(),
      glob: z.string().optional(),
      ignore_case: z.boolean().optional()
    },
    ({ pattern, path, glob, ignore_case }) => {
      const r = folder(path);
      if ('refused' in r) return no(r.refused);
      let re: RegExp;
      try {
        re = new RegExp(pattern, ignore_case ? 'i' : '');
      } catch (e) {
        return no(`That pattern is not a regular expression: ${(e as Error).message}`);
      }
      const only = glob ? globRegex(glob) : undefined;
      // A file the walk reached without a link is inside the folder; only a link is judged again.
      const files = statSync(r.path).isDirectory()
        ? [...walk(r.path)].map((f) => ({ file: join(r.path, f.rel), link: f.link }))
        : [{ file: r.path, link: false }];
      const hits: string[] = [];
      for (const { file, link } of files) {
        const name = relative(r.path, file).split(sep).join('/') || file.split(sep).at(-1)!;
        if (only && !only.test(name) && !only.test(name.split('/').at(-1)!)) continue;
        let target = file;
        if (link) {
          // A linked file is read only where the walls allow its target.
          const t = resolveIn(walls, file, 'read');
          if ('refused' in t) continue;
          target = t.path;
        }
        try {
          const st = statSync(target);
          // A file with a second name may be one outside the folders (file-walls.ts).
          if (st.nlink > 1 || st.size > MAX_SEARCH_FILE || !isText(target)) continue;
          const lines = readFileSync(target, 'utf8').split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              const line = lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i];
              hits.push(`${shown(walls, file)}:${i + 1}: ${line}`);
              if (hits.length > MAX_MATCHES) break;
            }
          }
        } catch {
          continue;
        }
        if (hits.length > MAX_MATCHES) break;
      }
      if (!hits.length) return ok(`No match for ${pattern}.`);
      const cut = hits.length > MAX_MATCHES ? '\n(More not shown: narrow the search.)' : '';
      return ok(hits.slice(0, MAX_MATCHES).join('\n') + cut);
    }
  );

  tool(
    'write_file',
    'Write a whole file, replacing it if it is there. Makes the folders it needs. To change part of a file, use edit_file.',
    { path: z.string(), content: z.string() },
    ({ path, content }) => {
      const r = resolveIn(walls, path, 'write');
      if ('refused' in r) return no(r.refused);
      mkdirSync(dirname(r.path), { recursive: true });
      writeFileSync(r.path, content);
      return ok(`Wrote ${shown(walls, r.path)} (${Buffer.byteLength(content)} bytes).`);
    }
  );

  tool(
    'edit_file',
    'Change part of a file: replace old_string, which must appear exactly once, with new_string. Set replace_all to change every one. Read the file first, and copy old_string exactly, with its spacing.',
    {
      path: z.string(),
      old_string: z.string().min(1),
      new_string: z.string(),
      replace_all: z.boolean().optional()
    },
    ({ path, old_string, new_string, replace_all }) => {
      const r = resolveIn(walls, path, 'write');
      if ('refused' in r) return no(r.refused);
      const before = readFileSync(r.path, 'utf8');
      // The file's own line endings, so an edit copied from a read of a CRLF file still matches.
      const crlf = before.includes('\r\n');
      const from = crlf ? old_string.replace(/\r?\n/g, '\r\n') : old_string;
      const to = crlf ? new_string.replace(/\r?\n/g, '\r\n') : new_string;
      const count = before.split(from).length - 1;
      if (!count) return no(`old_string is not in ${path}. Read the file and copy it exactly.`);
      if (count > 1 && !replace_all)
        return no(
          `old_string appears ${count} times in ${path}. Give more of it, or set replace_all.`
        );
      const after = replace_all ? before.split(from).join(to) : before.replace(from, () => to);
      writeFileSync(r.path, after);
      return ok(`Changed ${shown(walls, r.path)}${count > 1 ? ` in ${count} places` : ''}.`);
    }
  );

  return server;
}

// Started by the office (or the probe), not imported by a test.
if (
  process.argv[1] &&
  import.meta.filename === (await import('node:fs')).realpathSync(process.argv[1])
) {
  await fileServer(wallsFromEnv(process.env)).connect(new StdioServerTransport());
}
