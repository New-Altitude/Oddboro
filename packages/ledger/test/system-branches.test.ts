// A new branch on the operating system outside its one home fails here. A
// per-system choice goes in platform.ts, or in a lookup in a
// `Record<System, ...>` read through `currentSystem()`, which is not a branch.
// The existing branches move home over time, and the baseline falls with them.
// Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { parse, sourceFiles, type Source } from './source-files.ts';

/** The count at 71a7c3f, measured by this test. Lower it as branches move home; never raise it. */
const BASELINE = 49;

/** The one home of system branches, which the count leaves out. */
const HOME = new Set(['packages/ledger/src/platform.ts', 'packages/ledger/src/system-words.ts']);
const FLAGS = new Set(['MAC', 'LINUX', 'WINDOWS']);
const SYSTEM_NAMES = new Set(['darwin', 'win32', 'linux', 'mac', 'windows']);
const COMPARES = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken
]);

/** An import, an export or a declaration of the name itself, which reads nothing. */
function namesOnly(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    (ts.isVariableDeclaration(p) && p.name === id)
  );
}

const systemName = (n: ts.Node) =>
  (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && SYSTEM_NAMES.has(n.text);

/**
 * The line of each branch on the system in one file: each read of `MAC`,
 * `LINUX` or `WINDOWS`, and each `===`, `!==` or `case` with a system's name
 * on one side. It goes by name, so a constant of another meaning named `MAC`
 * counts too (sandbox-paths.ts's table): renaming one lowers the count.
 */
function branches({ ast }: Source): number[] {
  const lines: number[] = [];
  const visit = (n: ts.Node): void => {
    if (
      (ts.isIdentifier(n) && FLAGS.has(n.text) && !namesOnly(n)) ||
      (ts.isBinaryExpression(n) &&
        COMPARES.has(n.operatorToken.kind) &&
        (systemName(n.left) || systemName(n.right))) ||
      (ts.isCaseClause(n) && systemName(n.expression))
    )
      lines.push(ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1);
    ts.forEachChild(n, visit);
  };
  visit(ast);
  return lines;
}

test('each kind of system branch counts once, and an import, an export or a table lookup does not', () => {
  const lines = branches(
    parse(
      'example.ts',
      [
        "import { MAC, LINUX, WINDOWS, currentSystem } from './platform.ts';", // 1
        'export { MAC };', // 2
        'const PLACE: Record<string, string> = { mac: "a", linux: "b", windows: "c" };', // 3
        'const here = PLACE[currentSystem() ?? "linux"];', // 4
        'if (MAC) console.log(here);', // 5: counts
        'const tool = WINDOWS ? "where.exe" : "which";', // 6: counts
        "if (currentSystem() === 'linux') console.log(tool);", // 7: counts
        "if ('win32' !== process.platform) console.log(LINUX);", // 8: counts twice
        'switch (currentSystem()) {', // 9
        "  case 'mac':", // 10: counts
        '    break;', // 11
        '}' // 12
      ].join('\n')
    )
  );
  assert.deepEqual(lines, [5, 6, 7, 8, 8, 10]);
});

test('no file outside platform.ts and system-words.ts adds a branch on the system', () => {
  const files = sourceFiles().filter((f) => !HOME.has(f.path));
  const counts = files
    .map((f) => ({ path: f.path, lines: branches(f) }))
    .filter((f) => f.lines.length);
  const total = counts.reduce((n, f) => n + f.lines.length, 0);
  assert.ok(files.length > 0, 'no source file was parsed, so nothing was checked');
  assert.ok(total > 0, 'no branch was counted, so the counter reads nothing');
  assert.ok(
    total <= BASELINE,
    `${total} branches on the system outside platform.ts, above the ${BASELINE} allowed. ` +
      'Put the new choice in platform.ts, or in a Record<System, ...> read through currentSystem(). ' +
      `Each file's branches:\n${counts.map((f) => `${f.path}: ${f.lines.join(', ')}`).join('\n')}`
  );
});
