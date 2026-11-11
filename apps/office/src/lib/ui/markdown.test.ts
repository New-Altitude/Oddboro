// What an Odd's text links, in the office and outside it. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askAbout } from './file-links.ts';
import { renderMarkdown } from './markdown.ts';

const refused = new Set<string>();
// The name the office gives a full path into a folder the owner gave an Odd.
const renamed = new Map<string, string>();
// The page's one call: the office says every name opens, but those in `refused`.
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const { files } = JSON.parse(String(init.body)) as { files: { path: string }[] };
  return Response.json(
    files.map((f) => (refused.has(f.path) ? null : (renamed.get(f.path) ?? f.path)))
  );
}) as typeof fetch;

/** `text` as the page shows it once the office has answered about its names. */
async function shown(text: string, staff?: string): Promise<string> {
  await askAbout(renderMarkdown(text, staff).unknown);
  return renderMarkdown(text, staff).html.trim();
}
/** What the owner reads of `html`. */
const visible = (html: string): string => html.split(/<[^>]*>/).join('');

const FULL_PAGE = '/Users/Shared/.oddboro/threads/1/vera/m/index.html';
const PAGE_NAME = 'vera:threads/1/vera/m/index.html';
const LINK = `<a href="#" data-file="${PAGE_NAME}">`;
const NAMED = `<a href="#" data-file="${PAGE_NAME}" title="Open index.html">`;
const BUTTON = `<button type="button" data-page="${PAGE_NAME}" class="open-page">Open in browser</button>`;

test('a bare file name stays text, and only a written-out address links', () => {
  assert.equal(renderMarkdown('plan.md').html.trim(), '<p>plan.md</p>');
  assert.equal(renderMarkdown('www.example.com').html.trim(), '<p>www.example.com</p>');
  assert.equal(
    renderMarkdown('https://x.y').html.trim(),
    '<p><a href="https://x.y" target="_blank" rel="noopener noreferrer">https://x.y</a></p>'
  );
});

for (const [row, text, html, staff] of [
  [
    'a full path into a thread, in plain text, is a link by its bare name with its button',
    `Built ${FULL_PAGE} today`,
    `<p>Built ${NAMED}index.html</a>${BUTTON} today</p>`
  ],
  [
    'the same path in backticks shows its bare name in code',
    `\`${FULL_PAGE}\``,
    `<p>${NAMED}<code>index.html</code></a>${BUTTON}</p>`
  ],
  [
    'a file: link to a thread file keeps the words the Odd wrote, with no brackets and no file: href',
    `[a](file://${FULL_PAGE})`,
    `<p>${LINK}a</a>${BUTTON}</p>`
  ],
  [
    'an autolink to a thread file shows its bare name',
    `<file://${FULL_PAGE}>`,
    `<p>${LINK}index.html</a>${BUTTON}</p>`
  ],
  [
    'a link whose label is the full path shows the bare name',
    `[${FULL_PAGE}](file://${FULL_PAGE})`,
    `<p>${LINK}index.html</a>${BUTTON}</p>`
  ],
  [
    'a link whose label is the full path in backticks shows the bare name in code',
    `[\`${FULL_PAGE}\`](file://${FULL_PAGE})`,
    `<p>${LINK}<code>index.html</code></a>${BUTTON}</p>`
  ],
  [
    'a link whose label is the full path in bold shows the bare name in bold',
    `[**${FULL_PAGE}**](file://${FULL_PAGE})`,
    `<p>${LINK}<strong>index.html</strong></a>${BUTTON}</p>`
  ],
  [
    'a link labelled with a bare name keeps that label, even when it opens another file',
    '[notes.md](file:///Users/Shared/.oddboro/threads/1/vera/draft.md)',
    '<p><a href="#" data-file="vera:threads/1/vera/draft.md">notes.md</a></p>'
  ],
  [
    'a full path on a Linux home is a name',
    '`/home/runner/.oddboro/threads/2/vera/a.md`',
    '<p><a href="#" data-file="vera:threads/2/vera/a.md" title="Open a.md"><code>a.md</code></a></p>'
  ],
  [
    'a full path under a dev home is a name, in plain text too',
    'See /Users/Shared/.oddboro-dev/threads/3/vera/b.md.',
    '<p>See <a href="#" data-file="vera:threads/3/vera/b.md" title="Open b.md">b.md</a>.</p>'
  ],
  [
    "a colleague's full path names the colleague's file, whoever wrote the text",
    `\`${FULL_PAGE}\``,
    `<p>${NAMED}<code>index.html</code></a>${BUTTON}</p>`,
    'jax'
  ],
  [
    "a full path in plain text into an Odd's own folder still shows its path there",
    '/Users/Shared/.oddboro/staff/vera/notes/a.md',
    '<p><a href="#" data-file="vera:notes/a.md" title="Open notes/a.md">notes/a.md</a></p>'
  ],
  [
    'a full path from ~ into a thread is a link by its bare name with its button',
    'Built ~/.oddboro/threads/1/vera/m/index.html today',
    `<p>Built ${NAMED}index.html</a>${BUTTON} today</p>`
  ],
  [
    'a full path from ~ into a dev home is the same',
    'Built ~/.oddboro-dev/threads/1/vera/m/index.html today',
    `<p>Built ${NAMED}index.html</a>${BUTTON} today</p>`
  ],
  [
    "a full path into another Odd's own folder names that Odd's file, whoever wrote the text",
    '/Users/Shared/.oddboro/staff/rae/notes/a.md',
    '<p><a href="#" data-file="rae:notes/a.md" title="Open notes/a.md">notes/a.md</a></p>',
    'vera'
  ],
  [
    "a file: link to an Odd's own folder opens that file",
    '[a](file:///Users/Shared/.oddboro/staff/vera/notes/a.md)',
    '<p><a href="#" data-file="vera:notes/a.md">a</a></p>'
  ]
] as const satisfies readonly (readonly [string, string, string, string?])[])
  test(row, async () => {
    const out = await shown(text, staff);
    assert.equal(out, html);
    assert.doesNotMatch(out, /href="file:/);
    assert.doesNotMatch(visible(out), /threads|\.oddboro/);
  });

for (const [row, text, html] of [
  ['a file: link to no office file stays text', '[a](file:///etc/passwd)'],
  ['a javascript: link stays text', '[a](javascript:alert(1))'],
  ['a data: link stays text', '[a](data:text/html;base64,eA==)'],
  [
    'a file: autolink to no office file stays text',
    '<file:///etc/passwd>',
    '<p>&lt;file:///etc/passwd&gt;</p>'
  ],
  ['a thread path with .. steps stays text', '~/.oddboro/threads/1/vera/../../x.md'],
  [
    'a thread path with .. steps in a file: link stays text',
    '[a](file:///Users/Shared/.oddboro/threads/1/vera/../../x.md)'
  ],
  [
    'a thread number past what a thread can have stays text',
    '/Users/Shared/.oddboro/threads/99999999999/vera/a.md'
  ],
  [
    'a thread number with leading zeros stays text, so it never reads another thread',
    '/Users/Shared/.oddboro/threads/007/vera/a.md'
  ],
  [
    'a file: link whose step decodes to .. stays text',
    '[a](file:///Users/Shared/.oddboro/threads/1/vera/%2e%2e/x.md)'
  ],
  [
    'a file: link whose step decodes to a folder separator stays text',
    '[a](file:///Users/Shared/.oddboro/threads/1/vera/..%2Fx.md)'
  ],
  [
    'a file: link to an Odd folder whose step decodes to a separator stays text',
    '[a](file:///Users/Shared/.oddboro/staff/vera/..%2Fx.md)'
  ],
  [
    'a file: link to an Odd folder whose step decodes to a backslash stays text',
    '[a](file:///Users/Shared/.oddboro/staff/vera/a%5Cb.md)'
  ],
  [
    'a file: link in a thread part whose step decodes to a backslash stays text',
    '[a](file:///Users/Shared/.oddboro/threads/1/vera/a%5Cb.md)'
  ],
  [
    'a file: link that is not valid escaping stays text',
    '[a](file:///Users/Shared/.oddboro/threads/1/vera/%FF.md)'
  ],
  ['a full path that is only a thread folder stays text', '/Users/Shared/.oddboro/threads/1/a.md'],
  ['a path without a home stays as it is', '.oddboro/staff/vera/sims/a/index.html']
] as readonly (readonly [string, string, string?])[])
  test(row, async () => {
    const before = renderMarkdown(text, 'vera');
    assert.deepEqual(before.unknown, [], 'the office is asked about nothing');
    assert.equal(before.html.trim(), html ?? `<p>${text}</p>`);
    assert.doesNotMatch(before.html, /<a |<button/);
  });

test('a file: link with a NUL in its name reads as its words once the office refuses it', async () => {
  refused.add('threads/1/vera/a\0.md');
  assert.equal(
    await shown('[a](file:///Users/Shared/.oddboro/threads/1/vera/a%00.md)'),
    '<p>a</p>'
  );
  refused.clear();
});

test('a path that is not a file: address keeps an escape that a name may hold', async () => {
  const name = 'vera:threads/1/vera/a%23b.md';
  assert.ok(
    (await shown('`/Users/Shared/.oddboro/threads/1/vera/a%23b.md`')).includes(
      `data-file="${name}"`
    )
  );
  assert.ok(
    (await shown('[a](/Users/Shared/.oddboro/threads/1/vera/a%23b.md)')).includes(
      `data-file="${name}"`
    )
  );
});

test("a .. path in backticks asks the office nothing, so it never falls through to the Odd's own folder", () => {
  const { html, unknown } = renderMarkdown('`~/.oddboro/threads/1/vera/../../x.md`', 'vera');
  assert.deepEqual(unknown, []);
  assert.equal(html.trim(), '<p><code>~/.oddboro/threads/1/vera/../../x.md</code></p>');
});

test('a file: image shows its alt text, with no image and no file: anywhere', async () => {
  for (const src of [
    'file:///Users/Shared/.oddboro/threads/1/vera/p.png',
    'file:///Users/Shared/.oddboro/staff/vera/p.png'
  ]) {
    const out = await shown(`![a](${src})`, 'vera');
    assert.equal(out, '<p>a</p>');
    assert.doesNotMatch(out, /<img|file:/);
  }
  // Inside a link it is still only the words.
  const inLink = await shown(
    `[![a](file:///Users/Shared/.oddboro/threads/1/vera/p.png)](https://x.y)`
  );
  assert.doesNotMatch(inLink, /<img|file:/);
  assert.match(inLink, />a<\/a>/);
});

test('a thread path shows as written until the office answers, and stays so when it opens nothing', async () => {
  const path = '/Users/Shared/.oddboro/threads/7/vera/gone.md';
  refused.add('threads/7/vera/gone.md');
  const first = renderMarkdown(`See ${path}`, 'vera');
  assert.deepEqual(first.unknown, [{ staff: 'vera', path: 'threads/7/vera/gone.md' }]);
  assert.equal(first.html.trim(), `<p>See ${path}</p>`);
  const out = await shown(`See ${path}`, 'vera');
  assert.equal(out, `<p>See ${path}</p>`);
  // A file: link to a name that opens nothing keeps its words and loses the link.
  assert.equal(await shown(`[a](file://${path})`, 'vera'), '<p>a</p>');
});

test('a backticked full path the office refused stays unlinked code', async () => {
  const path = '/Users/Shared/.oddboro/threads/8/vera/refused.md';
  refused.add('threads/8/vera/refused.md');
  assert.equal(await shown(`\`${path}\``, 'vera'), `<p><code>${path}</code></p>`);
});

test('an image at a web address still draws', async () => {
  const out = await shown('![a](https://x.y/p.png)');
  assert.equal(out, '<p><img src="https://x.y/p.png" alt="a"></p>');
});

test('a full path right after a link is its own file, not the link before it', async () => {
  const other = '/Users/Shared/.oddboro/threads/1/vera/other.md';
  const named = '<a href="#" data-file="vera:threads/1/vera/other.md" title="Open other.md">';
  const link = `[a](file://${FULL_PAGE})`;
  assert.equal(
    await shown(`${link} ${other}`),
    `<p>${LINK}a</a>${BUTTON} ${named}other.md</a></p>`
  );
  assert.equal(
    await shown(`${link}\`${other}\``),
    `<p>${LINK}a</a>${BUTTON}${named}<code>other.md</code></a></p>`
  );
});

const escaped = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

// Each is sentence punctuation after a path. The thread path and the Odd's own
// folder take different routes through the match, so both are tried.
for (const [where, path, link] of [
  ['a thread path', FULL_PAGE, `${NAMED}index.html</a>${BUTTON}`],
  [
    "a path in an Odd's own folder",
    '/Users/Shared/.oddboro/staff/vera/index.html',
    '<a href="#" data-file="vera:index.html" title="Open index.html">index.html</a><button type="button" data-page="vera:index.html" class="open-page">Open in browser</button>'
  ]
] as const)
  for (const mark of [
    '?',
    '!',
    '.',
    ',',
    ':',
    ';',
    ')',
    ']',
    '"',
    "'",
    '**',
    '...',
    '?!',
    '?)',
    '.)',
    '!"',
    '."',
    ".'",
    '?**',
    '\u2026',
    '\u201d',
    '\u2019',
    '\u2013',
    '\u2014'
  ])
    for (const [end, after] of [
      ['the end of the line', ''],
      ['a space', ' next']
    ])
      test(`${where} followed by ${mark} then ${end} links, and leaves the mark after it`, async () => {
        const out = await shown(`See ${path}${mark}${after}`);
        assert.equal(out, `<p>See ${link}${escaped(mark)}${after}</p>`);
      });

test('bold round a full path leaves the link inside the bold', async () => {
  assert.equal(
    await shown(`See **${FULL_PAGE}**?`),
    `<p>See <strong>${NAMED}index.html</a>${BUTTON}</strong>?</p>`
  );
});

test('a query written as part of a path matches nothing, as a path with no extension at its end', async () => {
  const text = `See ${FULL_PAGE}?x=1`;
  const { html, unknown } = renderMarkdown(text, 'vera');
  assert.deepEqual(unknown, []);
  assert.equal(html.trim(), `<p>${text}</p>`);
});

test('a path in running text stops at its name, and the prose after it stays', async () => {
  assert.equal(
    await shown('/Users/Shared/.oddboro/threads/1/vera/a.md and then more'),
    '<p><a href="#" data-file="vera:threads/1/vera/a.md" title="Open a.md">a.md</a> and then more</p>'
  );
});

// A correctly encoded file: link names a file by its decoded name, whatever that holds.
for (const [written, name] of [
  ['my%20page.html', 'my page.html'],
  ['sub%20dir/my%20page.html', 'sub dir/my page.html'],
  ['page(1).html', 'page(1).html'],
  ['a&b.html', 'a&b.html'],
  ['a%26b.html', 'a&b.html'],
  ['a%23b.html', 'a#b.html'],
  ['caf%C3%A9.html', 'caf\u00e9.html'],
  ['caf\u00e9.html', 'caf\u00e9.html'],
  ['100%25.html', '100%.html'],
  ['it%27s.html', "it's.html"]
] as const) {
  const url = `file:///Users/Shared/.oddboro/threads/1/vera/${written}`;
  const ref = escaped(`vera:threads/1/vera/${name}`);
  const opens = `<a href="#" data-file="${ref}">`;
  const button = `<button type="button" data-page="${ref}" class="open-page">Open in browser</button>`;

  test(`a file: link to ${name} keeps its label and opens that file`, async () => {
    assert.equal(await shown(`[a](${url})`), `<p>${opens}a</a>${button}</p>`);
  });

  test(`a file: autolink to ${name} shows the file's name`, async () => {
    assert.equal(
      await shown(`<${url}>`),
      `<p>${opens}${escaped(name.slice(name.lastIndexOf('/') + 1))}</a>${button}</p>`
    );
  });

  // A name with brackets in running text stays text, as it always has.
  if (!written.includes('('))
    test(`a file: address to ${name} written in running text opens that file`, async () => {
      assert.ok((await shown(`See ${url} now`)).includes(`data-file="${ref}"`));
    });
}

test('a full path into a folder the owner gave links by the name the office gives it, in text, code and a file: link', async () => {
  const page = '/Users/Shared/Projects/site/index.html';
  renamed.set(page, 'folders/site/index.html');
  renamed.set('~/Projects/site/index.html', 'folders/site/index.html');
  const plain = await shown(`Built ${page} today`, 'vera');
  assert.match(plain, /data-file="vera:folders\/site\/index\.html"/);
  assert.equal(visible(plain), 'Built site/index.htmlOpen in browser today');
  assert.equal(
    visible(await shown('`~/Projects/site/index.html`', 'vera')),
    'site/index.htmlOpen in browser'
  );
  const linked = await shown(`[the page](file://${page})`, 'vera');
  assert.doesNotMatch(linked, /file:/);
  assert.equal(visible(linked), 'the pageOpen in browser');
});

test('a full path in a link label among other words reads as its file name', async () => {
  const thread = await shown(
    '[open ~/.oddboro/threads/1/vera/a.md now](file:///Users/Shared/.oddboro/threads/1/vera/a.md)',
    'vera'
  );
  assert.equal(visible(thread), 'open a.md now');
  renamed.set('/Users/Shared/Projects/site/notes.md', 'folders/site/notes.md');
  const given = await shown(
    '[see /Users/Shared/Projects/site/notes.md here](file:///Users/Shared/Projects/site/notes.md)',
    'vera'
  );
  assert.equal(visible(given), 'see site/notes.md here');
});

test('a full path the office says opens nothing stays as written, and a file: link to it keeps only its words', async () => {
  refused.add('/Users/Shared/notes/a.md');
  assert.equal(await shown('[a](file:///Users/Shared/notes/a.md)', 'vera'), '<p>a</p>');
  assert.equal(
    await shown('See /Users/Shared/notes/a.md.', 'vera'),
    '<p>See /Users/Shared/notes/a.md.</p>'
  );
});

test('a full path outside the office asks nothing when no Odd wrote the text, and a web address or a/b/c.md is no path', () => {
  assert.deepEqual(renderMarkdown('See /Users/Shared/notes/b.md').unknown, []);
  assert.deepEqual(
    renderMarkdown('see https://example.com/a/b.html and a/b/c.md', 'vera').unknown,
    []
  );
});
