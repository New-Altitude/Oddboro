// How the office renders an Odd's text: markdown, with the names of its files
// turned into links the viewer opens. Plain TypeScript, so a test renders a
// reply exactly as the page does (`Markdown.svelte` shows it).
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { givenPath, shownPath, workName, workPath } from '@oddboro/ledger/work-paths';
import { PAGE } from '#lib/pages.ts';
import { openedAs, plainName } from './file-links.ts';
import type { FileRef } from './windows.svelte.ts';

// Raw HTML stays escaped, and markdown-it refuses javascript: links, so a
// staffer's text can format but never inject anything into the page.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
// Only a written-out address links. A bare name like plan.md reads as a domain
// (.md is a real one), so it would link out of the office instead of to the file.
md.linkify.set({ fuzzyLink: false });
const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  if (!tokens[i].attrGet('data-file')) {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLink(tokens, i, options, env, self);
};

// A staffer's files open in the office's viewer. A full path anywhere in the
// text, into its own folder or its part of a thread's folder, or a path inside
// its folder (like notes/x.md, or a bare x.md, which may be one it wrote on a
// thread) in code or a link when the text says which staffer wrote it, is a
// name. So is any other full path when the text says who wrote it: it may be a
// file in a folder the owner gave that staffer, and only the office knows
// which folders those are. A name links only once the office says it opens
// (`file-links.ts`), and to the file it opens, by the short name the office
// gives it; until then, and when it opens nothing, it stays text.
// A page (`PAGE`) links whenever the browser can open it, even when too big or
// not text for the viewer, and gets an "Open in browser" button beside it.
// Where a full path starts, in both uses below.
const FULL_START = String.raw`(?:file:\/\/)?(?:~|\/(?:Users|home)\/[^/\s]+)\/\.oddboro[^/\s]*\/(?:staff\/([a-z0-9-]+)|threads\/([1-9]\d*)\/([a-z0-9-]+))\/`;
// In running text a name has no space, or it would swallow the prose after it,
// and sentence punctuation after it is not part of it: closing marks, or a run
// of `.?!*` that ends the word. `index.html?x=1` is neither, so it matches nothing.
const FULL = new RegExp(
  String.raw`${FULL_START}([^\s\`'"<>()[\]]+?\.[A-Za-z0-9]+)(?=[.?!*\u2026]*(?:[\s\`'"<>()[\],;:\u201d\u2019\u2013\u2014]|$))`,
  'g'
);
// Where the whole of a target is the path (an address, a code span, a label),
// nothing follows the name, so a name may hold any character.
const WHOLE = new RegExp(String.raw`^${FULL_START}(.+\.[A-Za-z0-9]+)$`);
// Any other full path, from ~ or from the top, which the office may find in a
// folder the owner gave the staffer. In running text it starts a word, so the
// end of a web address or of a/b never reads as one, and ends as `FULL` does.
const GIVEN_TEXT = String.raw`(?<![\w/.~:-])(?:file:\/\/)?(?:~|\/[^/\s\`'"<>()[\]]+)\/[^\s\`'"<>()[\]]*?\.[A-Za-z0-9]+(?=[.?!*\u2026]*(?:[\s\`'"<>()[\],;:\u201d\u2019\u2013\u2014]|$))`;
const GIVEN_WHOLE = /^(?:file:\/\/)?((?:~|\/).*\/[^/]+\.[A-Za-z0-9]+)$/;
// An office path `fullName` refused never reads as one in a given folder: it stays refused.
const OFFICE_PATH = /\/\.oddboro[^/\s]*\/(?:staff|threads)\//;
/** The full path `text` names when it may be a file in a folder the owner gave, or undefined. */
function givenFull(text: string): string | undefined {
  const m = GIVEN_WHOLE.exec(text);
  return m && !OFFICE_PATH.test(m[1]) ? m[1] : undefined;
}
// Every full path in running text. An office path matches `FULL` first, so it reads as before.
const ANY_FULL = new RegExp(`${FULL.source}|${GIVEN_TEXT}`, 'g');
const INSIDE = /^(?:\.\/)?(?:[\w.-]+\/)*[\w-][\w.-]*\.(?:md|txt|json|csv|ya?ml|html?)$/;

/**
 * The file a match of `WHOLE` names. One in a thread's folder goes by its name
 * in the office (`workName`), for the Odd whose part holds it. A path
 * `workPath` refuses names nothing: passed on, the viewer would read it as a
 * path in that Odd's own folder.
 */
function fullName(m: RegExpExecArray): FileRef | undefined {
  const [, staff, thread, odd, rest] = m;
  if (thread === undefined) return { staff, path: rest };
  const path = workName(Number(thread), `${odd}/${rest}`);
  return workPath(path) ? { staff: odd, path } : undefined;
}

/** Who wrote the text, and the names in it the office has not been asked about. */
type Env = { staff?: string; unknown: FileRef[] };
function fileOf(target: string, env: Env): FileRef | undefined {
  const t = pathOf(target);
  if (t === undefined) return undefined;
  const m = WHOLE.exec(t);
  if (m) return fullName(m);
  if (!env.staff) return undefined;
  const given = givenFull(t);
  if (given) return { staff: env.staff, path: given };
  if (INSIDE.test(t)) return { staff: env.staff, path: t.replace(/^\.\//, '') };
  return undefined;
}

/**
 * A name as a path. A `file:` address is a URL, so each step is decoded whole,
 * `%23` included, which `plainName` leaves alone. A step that decodes to a
 * folder separator names nothing: no file's name holds one, and `..%2F` would
 * step out of the folder. So does an address that is not valid escaping.
 */
function pathOf(target: string): string | undefined {
  const t = target.trim();
  if (!t.startsWith('file:')) return plainName(t);
  try {
    const steps = t.split('/').map(decodeURIComponent);
    return steps.some((step) => /[/\\]/.test(step)) ? undefined : steps.join('/');
  } catch {
    return undefined;
  }
}

/** Whether the whole of `text` is a full path to an office file, whoever wrote it. */
const namesFile = (text: string): boolean => !!fileOf(text, { unknown: [] });

// markdown-it refuses every file: target, so an Odd's link to its own work
// stayed as raw brackets. One the office can name passes, and `staff_files`
// rewrites it, so no file: address reaches the page.
// A file: link to any other full path passes too, since only the office knows
// whether it is in a folder the owner gave; one that opens nothing loses its link.
const allowedByDefault = md.validateLink;
md.validateLink = (url) =>
  allowedByDefault(url) || namesFile(url) || !!givenFull(pathOf(url) ?? '');

/** What the owner reads of a name that opens `f`: the office's short name for a file in a folder the owner gave, else the name as the Odd wrote it. */
const shownAs = (name: FileRef, f: FileRef): string =>
  shownPath(givenPath(f.path) ? f.path : name.path);

/** The file a name opens, or undefined while it opens nothing known. */
function opened(f: FileRef, env: Env): FileRef | undefined {
  const path = openedAs(f);
  if (path === undefined) env.unknown.push(f);
  return path ? { staff: f.staff, path } : undefined;
}

function textToken(state: { Token: typeof Token }, content: string): Token {
  const t = new state.Token('text', '', 0);
  t.content = content;
  return t;
}

function linkTokens(state: { Token: typeof Token }, f: FileRef) {
  const open = new state.Token('link_open', 'a', 1);
  open.attrs = [
    ['href', '#'],
    ['data-file', `${f.staff}:${f.path}`],
    ['title', `Open ${shownPath(f.path)}`]
  ];
  return { open, close: new state.Token('link_close', 'a', -1) };
}

/** After the link to a page, a button that opens it in the owner's browser; nothing for any other file. */
function pageButton(state: { Token: typeof Token }, f: FileRef): Token[] {
  if (!PAGE.test(f.path)) return [];
  const open = new state.Token('button_open', 'button', 1);
  open.attrs = [
    ['type', 'button'],
    ['data-page', `${f.staff}:${f.path}`],
    ['class', 'open-page']
  ];
  return [open, textToken(state, 'Open in browser'), new state.Token('button_close', 'button', -1)];
}

md.core.ruler.push('staff_files', (state) => {
  const env = state.env as Env;
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const out: Token[] = [];
    let inLink = 0;
    // A link to a name that opens nothing keeps its words and loses the link.
    let unlinked = false;
    // What goes after the link being read once it closes: a page's button.
    let after: Token[] = [];
    // The file the link being read opens, when the rewrite took it.
    let linked: FileRef | undefined;
    for (const child of block.children) {
      // `validateLink` lets a file: image through too, and nothing may draw one, so it reads as its words.
      const t =
        child.type === 'image' && child.attrGet('src')?.startsWith('file:')
          ? textToken(state, child.content)
          : child;
      if (t.type === 'link_open') {
        inLink++;
        const href = t.attrGet('href') ?? '';
        const name = fileOf(href, env);
        const f = name && opened(name, env);
        if (f) {
          t.attrSet('href', '#');
          t.attrSet('data-file', `${f.staff}:${f.path}`);
          after = pageButton(state, f);
          linked = f;
        } else if (name || href.startsWith('file:')) {
          // No file: address reaches the page, whatever it names.
          unlinked = true;
          continue;
        }
      } else if (t.type === 'link_close') {
        inLink--;
        if (unlinked) {
          unlinked = false;
          continue;
        }
        out.push(t, ...after);
        after = [];
        linked = undefined;
        continue;
      }
      // A full path in a label reads as its file's name, whatever words are round it.
      if (linked && (t.type === 'text' || t.type === 'code_inline')) {
        t.content = t.content.replace(ANY_FULL, (path) => {
          const name = fileOf(path, env);
          const f = name && opened(name, env);
          return name && f ? shownAs(name, f) : path;
        });
        if (namesFile(t.content)) t.content = shownPath(linked.path);
      }
      const name = !inLink && t.type === 'code_inline' ? fileOf(t.content, env) : undefined;
      const f = name && opened(name, env);
      if (name && f) {
        const { open, close } = linkTokens(state, f);
        // A name in a thread's folder reads as its bare name: the owner never sees a thread.
        t.content = shownAs(name, f);
        out.push(open, t, close, ...pageButton(state, f));
        continue;
      }
      if (inLink || t.type !== 'text' || !t.content.includes('/')) {
        out.push(t);
        continue;
      }
      // Split plain text around each full path the viewer opens, linking it.
      let at = 0;
      ANY_FULL.lastIndex = 0;
      for (let m = ANY_FULL.exec(t.content); m; m = ANY_FULL.exec(t.content)) {
        const name = fileOf(m[0], env);
        const f = name && opened(name, env);
        if (!name || !f) continue;
        const { open, close } = linkTokens(state, f);
        out.push(
          textToken(state, t.content.slice(at, m.index)),
          open,
          textToken(state, shownAs(name, f)),
          close,
          ...pageButton(state, f)
        );
        at = m.index + m[0].length;
      }
      out.push(textToken(state, t.content.slice(at)));
    }
    block.children = out;
  }
});

/**
 * `text` as HTML, with `staff` as who wrote it, and the names in it the office
 * has not been asked about yet (`askAbout`), which render as text until it answers.
 */
export function renderMarkdown(text: string, staff?: string): { html: string; unknown: FileRef[] } {
  const env: Env = { staff, unknown: [] };
  return { html: md.render(text, env), unknown: env.unknown };
}
