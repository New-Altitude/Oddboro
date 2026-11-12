// One row per state of the rule both guards keep: a request without the
// owner's key reaches only an exact exception route, judged on the same text
// the server routes on. The dev server's guard, the office's guard and the
// rule itself are each tested against this one table, so a new state is a new
// row here, never a single case in one guard's test.
//
// `dev` is what the dev server's guard does with the raw target: 'passes'
// hands it on, 'refused' answers 403. `office` is what the office's guard
// does with the path its router gives it: 'passes' treats it as an exception,
// whose own proof (a token, or GET for a sign-in page) is checked after;
// 'unparsed' means the router cannot read it at all. Each value is written
// out by hand, never worked out from the rule, so a broken rule cannot agree
// with itself. A caller fills in `<root>` with the dev server's root.

export type RequestTarget = {
  target: string;
  dev: 'refused' | 'passes';
  office: 'refused' | 'passes' | 'unparsed';
  why: string;
};

export const REQUEST_TARGETS: readonly RequestTarget[] = [
  // Hostile: none of these is an exception route.
  {
    target: '//x/api/gateway/notes',
    dev: 'refused',
    office: 'refused',
    why: 'A URL parse reads x as a host and the rest as a gateway path, while the dev server serves /x/api/gateway/notes.'
  },
  {
    target: '//x/api/gateway/notes?raw',
    dev: 'refused',
    office: 'refused',
    why: 'The same doubled slash, with a query that asks the dev server for a file raw.'
  },
  {
    target: '//%5c..%5c..%5c@h/api/gateway/x',
    dev: 'refused',
    office: 'refused',
    why: 'Escaped backslashes that the dev server decodes into steps out of the folder.'
  },
  {
    target: '/api/gateway/..%5c..%5cpackage.json',
    dev: 'refused',
    office: 'refused',
    why: 'On Windows an escaped backslash is a folder separator once decoded, so this climbs out of the route.'
  },
  {
    target: '/api/gateway/%2e%2e/x',
    dev: 'refused',
    office: 'refused',
    why: 'An escaped .. step: the office resolves it to /api/x, and the dev server must not decode it.'
  },
  {
    target: '/api/gateway/.%2e/x',
    dev: 'refused',
    office: 'refused',
    why: 'Half of a .. step escaped, which a URL parse still reads as one.'
  },
  {
    target: '/api/gateway/../x',
    dev: 'refused',
    office: 'refused',
    why: 'A plain .. step out of the gateway route.'
  },
  {
    target: '/api/gateway/x/',
    dev: 'refused',
    office: 'refused',
    why: 'A run never sends a trailing slash, so the route takes none.'
  },
  {
    target: '/api/gateway/x%00',
    dev: 'refused',
    office: 'refused',
    why: 'An escaped null byte in a connector id.'
  },
  {
    target: '/api/gateway/no\ttes',
    dev: 'refused',
    office: 'passes',
    why: "A URL parse drops the tab, so the office routes it as /api/gateway/notes with its run's token; Node answers 400 to a raw tab before either guard."
  },
  {
    target: '/api/gateway/x;/',
    dev: 'refused',
    office: 'refused',
    why: 'A semicolon some servers read as the end of a path.'
  },
  {
    target: 'http://h/api/gateway/x',
    dev: 'refused',
    office: 'unparsed',
    why: 'The absolute form does not start with a slash, and the office cannot read it as a path.'
  },
  {
    target: '/@fs/<root>/package.json?oddboro-key=wrong',
    dev: 'refused',
    office: 'refused',
    why: 'The dev server serves any file under /@fs/ whatever the query, so a wrong key must not pass it on.'
  },
  {
    target: '/@vite/client?oddboro-key=wrong',
    dev: 'refused',
    office: 'refused',
    why: "The dev server's own client, with a wrong key."
  },
  {
    target: '/account/callback/x',
    dev: 'refused',
    office: 'refused',
    why: 'A step below a sign-in page is no sign-in page.'
  },
  {
    target: '/account/callback/',
    dev: 'refused',
    office: 'refused',
    why: 'A sign-in page with a trailing slash is another path.'
  },
  {
    target: '/account/callback/../x',
    dev: 'refused',
    office: 'refused',
    why: 'A .. step out of a sign-in page; the office resolves it to /account/x.'
  },
  {
    target: '/connect/callback/x',
    dev: 'refused',
    office: 'refused',
    why: 'A step below a sign-in page is no sign-in page.'
  },
  {
    target: '/connect/callback/',
    dev: 'refused',
    office: 'refused',
    why: 'A sign-in page with a trailing slash is another path.'
  },
  {
    target: '/connect/callback/../x',
    dev: 'refused',
    office: 'refused',
    why: 'A .. step out of a sign-in page; the office resolves it to /connect/x.'
  },
  {
    target: '/api/update/',
    dev: 'refused',
    office: 'refused',
    why: 'The update route with a trailing slash is another path.'
  },
  {
    target: '/api/update/x',
    dev: 'refused',
    office: 'refused',
    why: 'A step below the update route.'
  },
  {
    target: '/api/gateway/./notes',
    dev: 'refused',
    office: 'passes',
    why: "The office resolves the . step, so it routes /api/gateway/notes with its run's token; the dev server refuses the raw text, the stricter of the two."
  },
  {
    target: '/api/gateway/Notes',
    dev: 'refused',
    office: 'refused',
    why: 'A connector id is lowercase.'
  },
  {
    target: '/api/gateway/a/b',
    dev: 'refused',
    office: 'refused',
    why: 'A connector id is one step.'
  },
  {
    target: '/api/gateway/',
    dev: 'refused',
    office: 'refused',
    why: 'No connector id.'
  },
  {
    target: '/api/gateway/a\\b',
    dev: 'refused',
    office: 'refused',
    why: 'A backslash is a folder separator on Windows; a URL parse reads it as /api/gateway/a/b.'
  },
  {
    target: '/api/gateway/%6eotes',
    dev: 'refused',
    office: 'refused',
    why: 'An escaped letter: the rule never decodes, so it is no connector id.'
  },
  {
    target: '/API/update',
    dev: 'refused',
    office: 'refused',
    why: 'Routes are matched by case, and this is not the update route.'
  },
  {
    target: '/api/gateway/notes/',
    dev: 'refused',
    office: 'refused',
    why: 'A run never sends a trailing slash, so the route takes none.'
  },
  {
    target: '/api/update/__data.json',
    dev: 'refused',
    office: 'passes',
    why: "The office's router removes its own /__data.json suffix before the guard runs, so the guard sees the update route, which still demands the shell's token; the dev server refuses the raw text."
  },
  {
    target: '/api/update#/../secret.txt',
    dev: 'refused',
    office: 'passes',
    why: "The office's router drops the fragment, so the path is the update route, which still demands the shell's token; the dev server refuses the raw text."
  },
  {
    target: '/api/update#x',
    dev: 'refused',
    office: 'passes',
    why: "The office's router drops the fragment, so the path is the update route, which still demands the shell's token; the dev server refuses the raw text."
  },

  // Exception routes: each passes on to its own proof.
  {
    target: '/api/update',
    dev: 'passes',
    office: 'passes',
    why: "The shell's update route, proved by the shell's token."
  },
  {
    target: '/account/callback',
    dev: 'passes',
    office: 'passes',
    why: "A tool's sign-in page, proved by the sign-in's state."
  },
  {
    target: '/account/callback?code=c&state=s',
    dev: 'passes',
    office: 'passes',
    why: 'A sign-in coming back with its code and state.'
  },
  {
    target: '/connect/callback',
    dev: 'passes',
    office: 'passes',
    why: "A connector's sign-in page, proved by the sign-in's state."
  },
  {
    target: '/api/gateway/notes',
    dev: 'passes',
    office: 'passes',
    why: "A run reaching one of its tools, proved by the run's token."
  },
  {
    target: '/api/gateway/gmail-2',
    dev: 'passes',
    office: 'passes',
    why: "A second Google account's connector id, with its dash and digit."
  },
  {
    target: '/api/update?import',
    dev: 'passes',
    office: 'passes',
    why: 'An exception path with any query: nothing in the dev server sits at that path, so the route answers.'
  },
  {
    target: '/api/update?raw',
    dev: 'passes',
    office: 'passes',
    why: 'An exception path with any query: nothing in the dev server sits at that path, so the route answers.'
  },
  {
    target: '/api/update?url',
    dev: 'passes',
    office: 'passes',
    why: 'An exception path with any query: nothing in the dev server sits at that path, so the route answers.'
  },
  {
    target: '/account/callback?import&raw',
    dev: 'passes',
    office: 'passes',
    why: 'An exception path with any query: nothing in the dev server sits at that path, so the route answers.'
  },
  {
    target: '/api/gateway/x?import',
    dev: 'passes',
    office: 'passes',
    why: "An exception path with any query: the route answers, and asks for the run's token."
  },
  {
    target: '/api/gateway/secret?raw',
    dev: 'passes',
    office: 'passes',
    why: "An exception path with any query: the route answers, and asks for the run's token."
  },
  {
    target: '/api/gateway/x?/../../secret.txt',
    dev: 'passes',
    office: 'passes',
    why: 'Steps after the ? are query, not path: the path is the gateway route, which asks for a run token.'
  },
  {
    target: '/api/gateway/x?oddboro-key=wrong',
    dev: 'passes',
    office: 'passes',
    why: "The path is an exact exception, which passes whatever the query; a run's token is checked after. A wrong key refuses only a path that is no exception."
  }
];
