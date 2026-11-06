// How the office renders an Odd's text: markdown, with the names of its files
// turned into links the viewer opens. Plain TypeScript, so a test renders a
// reply exactly as the page does (`Markdown.svelte` shows it).
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { shownPath } from '@oddboro/ledger/work-paths';
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
// text, or a path inside its folder (like notes/x.md, or a bare x.md, which
// may be one it wrote on a thread) in code or a link when the text says which
// staffer wrote it, is a name. A name links only once the office says it
// opens (`file-links.ts`), and to the file it opens; until then, and when it
// opens nothing, it stays text. A page (`PAGE`) links whenever the browser can
// open it, even when too big or not text for the viewer, and gets an "Open in
// browser" button beside it.
const FULL =
  /(?:file:\/\/)?(?:~|\/(?:Users|home)\/[^/\s]+)\/\.oddboro[^/\s]*\/staff\/([a-z0-9-]+)\/([^\s`'"<>()[\]]+?\.[A-Za-z0-9]+)(?=[\s`'"<>()[\],;:]|\.(?:\s|$)|$)/g;
const INSIDE = /^(?:\.\/)?(?:[\w.-]+\/)*[\w-][\w.-]*\.(?:md|txt|json|csv|ya?ml|html?)$/;

/** Who wrote the text, and the names in it the office has not been asked about. */
type Env = { staff?: string; unknown: FileRef[] };
function fileOf(target: string, env: Env): FileRef | undefined {
  const t = plainName(target);
  FULL.lastIndex = 0;
  const m = FULL.exec(t);
  if (m && m.index === 0 && m[0].length === t.length) return { staff: m[1], path: m[2] };
  if (env.staff && INSIDE.test(t)) return { staff: env.staff, path: t.replace(/^\.\//, '') };
  return undefined;
}

/** The file a name opens, or undefined while it opens nothing known. */
function opened(f: FileRef, env: Env): FileRef | undefined {
  const path = openedAs(f);
  if (path === undefined) env.unknown.push(f);
  return path ? { staff: f.staff, path } : undefined;
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
  const label = new state.Token('text', '', 0);
  label.content = 'Open in browser';
  return [open, label, new state.Token('button_close', 'button', -1)];
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
    for (const t of block.children) {
      if (t.type === 'link_open') {
        inLink++;
        const name = fileOf(t.attrGet('href') ?? '', env);
        const f = name && opened(name, env);
        if (f) {
          t.attrSet('href', '#');
          t.attrSet('data-file', `${f.staff}:${f.path}`);
          after = pageButton(state, f);
        } else if (name) {
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
        continue;
      }
      const name = !inLink && t.type === 'code_inline' ? fileOf(t.content, env) : undefined;
      const f = name && opened(name, env);
      if (name && f) {
        const { open, close } = linkTokens(state, f);
        // A name in a thread's folder reads as its bare name: the owner never sees a thread.
        t.content = shownPath(name.path);
        out.push(open, t, close, ...pageButton(state, f));
        continue;
      }
      if (inLink || t.type !== 'text' || !/\.oddboro[^/\s]*\/staff\//.test(t.content)) {
        out.push(t);
        continue;
      }
      // Split plain text around each full path the viewer opens, linking it.
      let at = 0;
      FULL.lastIndex = 0;
      for (let m = FULL.exec(t.content); m; m = FULL.exec(t.content)) {
        const f = opened({ staff: m[1], path: m[2] }, env);
        if (!f) continue;
        const before = new state.Token('text', '', 0);
        before.content = t.content.slice(at, m.index);
        const label = new state.Token('text', '', 0);
        label.content = m[2];
        const { open, close } = linkTokens(state, f);
        out.push(before, open, label, close, ...pageButton(state, f));
        at = m.index + m[0].length;
      }
      const rest = new state.Token('text', '', 0);
      rest.content = t.content.slice(at);
      out.push(rest);
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
