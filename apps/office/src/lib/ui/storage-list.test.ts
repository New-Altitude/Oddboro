import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  beforeName,
  countFiles,
  countLine,
  matching,
  nameOf,
  nothingKept,
  ownRows,
  parentOf,
  sharedRows,
  shownAs,
  treeOf,
  type Entry,
  type Work
} from './storage-list.ts';

const file = (path: string): Entry => ({ path, dir: false, size: 10, mtime: 1 });
const dir = (path: string): Entry => ({ path, dir: true, size: 0, mtime: 1 });

const site: Work = {
  title: 'Build the Site',
  root: 'threads/7/vera',
  entries: [
    dir('threads/7/vera/m'),
    file('threads/7/vera/m/index.html'),
    file('threads/7/vera/notes.md')
  ]
};
const launch: Work = {
  title: 'Plan the launch',
  root: 'threads/3/vera',
  entries: [file('threads/3/vera/plan.md')]
};
const own = ownRows([dir('sims'), file('sims/draft.md')]);
const shared = sharedRows([site, launch]);
const found = (mine: typeof own, theirs: typeof own, find: string) =>
  matching(mine, theirs, find).map(shownAs);

describe('a shared row', () => {
  it('reads as its work title and its path below the root', () => {
    assert.deepEqual(shared.map(shownAs), [
      'Build the Site/m',
      'Build the Site/m/index.html',
      'Build the Site/notes.md',
      'Plan the launch/plan.md'
    ]);
  });

  it('keeps the title and the path below the root apart for the search row', () => {
    const row = shared[1];
    assert.equal(row.work, 'Build the Site');
    assert.equal(row.below, 'm/index.html');
  });

  it('keeps the full path, which is the one the viewer opens', () => {
    assert.equal(shared[1].path, 'threads/7/vera/m/index.html');
  });

  it('never holds a thread folder in the words the owner reads', () => {
    for (const row of shared) assert.doesNotMatch(shownAs(row), /threads\/\d/);
  });
});

describe('a search row', () => {
  const pieces = (r: (typeof own)[number]) => [r.work, beforeName(r), nameOf(r.below)];

  it('splits a shared file into its title, its folders and its bare name', () => {
    assert.deepEqual(pieces(shared[1]), ['Build the Site', '/m/', 'index.html']);
  });

  it('has only a slash before the name of a shared file at the top of its work', () => {
    assert.deepEqual(pieces(shared[2]), ['Build the Site', '/', 'notes.md']);
  });

  it('splits an own file into its folders and its bare name', () => {
    assert.deepEqual(pieces(own[1]), [undefined, 'sims/', 'draft.md']);
  });

  it('has nothing before the name of an own file at the top', () => {
    const [top] = ownRows([file('plan.md')]);
    assert.deepEqual(pieces(top), [undefined, '', 'plan.md']);
  });

  it('reads, piece by piece, the same as the row tooltip', () => {
    for (const r of [...own, ...shared].filter((row) => !row.dir))
      assert.equal(pieces(r).join(''), shownAs(r));
  });
});

describe('an own row', () => {
  const lookalike = ownRows([file('threads/7/vera/notes.md')]);

  it('reads as its path', () => {
    assert.equal(shownAs(own[1]), 'sims/draft.md');
  });

  it('keeps its own words at a path that reads like a shared one', () => {
    assert.equal(shownAs(lookalike[0]), 'threads/7/vera/notes.md');
    assert.equal(lookalike[0].work, undefined);
  });

  it('is found by its own words at that path, and not by the title of the work it reads like', () => {
    assert.deepEqual(found(lookalike, [], 'threads'), ['threads/7/vera/notes.md']);
    assert.deepEqual(found(lookalike, [], 'build the site'), []);
  });

  it('sits apart from the shared row at the same path, each with its own words', () => {
    assert.deepEqual(found(lookalike, shared, 'notes.md'), [
      'threads/7/vera/notes.md',
      'Build the Site/notes.md'
    ]);
  });
});

describe('search', () => {
  it('finds no shared file by the word threads, an Odd name or a thread number', () => {
    for (const word of ['threads', 'vera', '7']) assert.deepEqual(found(own, shared, word), []);
  });

  it('finds a shared file when its title holds that word', () => {
    const work = sharedRows([{ ...launch, title: 'Vera threads 7' }]);
    for (const word of ['threads', 'vera', '7'])
      assert.deepEqual(found([], work, word), ['Vera threads 7/plan.md']);
  });

  it('finds a shared file when its path below the root holds that word', () => {
    const work = sharedRows([{ ...launch, entries: [file('threads/3/vera/vera-7-threads.md')] }]);
    for (const word of ['threads', 'vera', '7'])
      assert.deepEqual(found([], work, word), ['Plan the launch/vera-7-threads.md']);
  });

  it('finds every file of a work by a word of its title, in any case', () => {
    assert.deepEqual(found(own, shared, 'bUILD the'), [
      'Build the Site/m/index.html',
      'Build the Site/notes.md'
    ]);
  });

  it('finds a file by its bare name', () => {
    assert.deepEqual(found(own, shared, 'plan.md'), ['Plan the launch/plan.md']);
    assert.deepEqual(found(own, shared, 'draft.md'), ['sims/draft.md']);
  });

  it('lists an own file before a shared one', () => {
    const mine = ownRows([file('plan.md')]);
    assert.deepEqual(found(mine, shared, 'plan'), ['plan.md', 'Plan the launch/plan.md']);
  });

  it('leaves out folders', () => {
    assert.deepEqual(found(own, shared, 'sims'), ['sims/draft.md']);
    assert.deepEqual(found(own, shared, 'site/m'), ['Build the Site/m/index.html']);
  });

  it('ignores spaces around the words', () => {
    assert.deepEqual(found(own, shared, '  plan.md  '), ['Plan the launch/plan.md']);
  });

  it('finds nothing for an empty or blank box', () => {
    assert.deepEqual(found(own, shared, ''), []);
    assert.deepEqual(found(own, shared, '   '), []);
  });
});

describe('the lines above the lists', () => {
  it('counts one file in the singular, and any other number in the plural', () => {
    assert.equal(countLine(own, "Vera's folder"), "1 file in Vera's folder.");
    assert.equal(countLine(shared, 'shared work'), '3 files in shared work.');
    assert.equal(countLine([], 'shared work'), '0 files in shared work.');
  });

  it('counts files and not the folders among the rows', () => {
    assert.equal(countLine(ownRows([dir('sims')]), "Vera's folder"), "0 files in Vera's folder.");
  });

  it('says nothing is kept only with no entry of its own and no work', () => {
    assert.equal(nothingKept([], []), true);
    assert.equal(nothingKept([file('plan.md')], []), false);
    assert.equal(nothingKept([], [site]), false);
  });
});

describe('a tree', () => {
  it('groups rows under their folder, with the top under the empty name', () => {
    const tree = treeOf(own);
    assert.deepEqual(
      tree[''].map((r) => r.path),
      ['sims']
    );
    assert.deepEqual(
      tree['sims'].map((r) => r.path),
      ['sims/draft.md']
    );
  });

  it('holds a shared file under its work root, where the work folder opens', () => {
    const tree = treeOf(shared);
    assert.deepEqual(
      tree['threads/7/vera'].map((r) => r.path),
      ['threads/7/vera/m', 'threads/7/vera/notes.md']
    );
    assert.deepEqual(
      tree['threads/7/vera/m'].map((r) => r.path),
      ['threads/7/vera/m/index.html']
    );
  });

  it('counts files and not folders', () => {
    assert.equal(countFiles(own), 1);
    assert.equal(countFiles(shared), 3);
  });

  it('splits a path into its folder and its bare name', () => {
    assert.equal(parentOf('sims/a/index.html'), 'sims/a');
    assert.equal(nameOf('sims/a/index.html'), 'index.html');
    assert.equal(parentOf('plan.md'), '');
    assert.equal(nameOf('plan.md'), 'plan.md');
  });
});
