// Renders a document from src/content/<folder>/<name>.md at prerender: the
// body as HTML, a table of contents from its ## headings, and its title from
// the first # heading. The legal writer owns the files in legal/; info/
// holds the pages the office links to, such as why some folders warn.
import MarkdownIt from 'markdown-it';

const files = import.meta.glob('/src/content/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

export type LegalDoc = {
  title: string;
  html: string;
  toc: { id: string; text: string }[];
  /** True when the markdown file is not in the repo yet. */
  missing: boolean;
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const legal = (name: 'privacy' | 'terms', fallbackTitle: string): LegalDoc =>
  markdownDoc(`legal/${name}`, fallbackTitle);

/** A page the office links to, from src/content/info/<name>.md. */
export const info = (name: 'folder-sharing', fallbackTitle: string): LegalDoc =>
  markdownDoc(`info/${name}`, fallbackTitle);

function markdownDoc(name: string, fallbackTitle: string): LegalDoc {
  const text = files[`/src/content/${name}.md`];
  if (!text) {
    console.warn(`site: src/content/${name}.md is not here yet, so its page is a stub`);
    return { title: fallbackTitle, html: '', toc: [], missing: true };
  }
  // Raw HTML stays escaped, so the document can format but never inject.
  // Addresses written with their scheme and email addresses become links. A
  // bare domain stays text, so "oddboro.com" never turns into an http link.
  const md = new MarkdownIt({ html: false, linkify: true });
  md.linkify.set({ fuzzyLink: false });
  const tokens = md.parse(text, {});
  let title = fallbackTitle;
  let titled = false;
  const toc: LegalDoc['toc'] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const content = inline?.content ?? '';
    if (t.tag === 'h1' && !titled) {
      title = content;
      titled = true;
      tokens.splice(i, 3);
      i--;
      continue;
    }
    if (t.tag !== 'h2' && t.tag !== 'h3') continue;
    const base = slugify(content) || 'section';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    t.attrSet('id', id);
    if (t.tag === 'h2') toc.push({ id, text: content });
  }
  return { title, html: md.renderer.render(tokens, md.options, {}), toc, missing: false };
}
