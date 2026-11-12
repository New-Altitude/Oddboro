// Every TypeScript file the office ships, parsed, for tests that hold a rule by
// the code's structure rather than by matching its words. The office's own
// code and each package's, never a test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** One parsed file, by its path from the repo's root, with forward slashes. */
export type Source = { path: string; ast: ts.SourceFile };

/** Parse one file's text as TypeScript. */
export function parse(path: string, text: string): Source {
  return { path, ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true) };
}

/** Every non-test `.ts` file under `apps/office/src` and each `packages/<name>/src`. */
export function sourceFiles(): Source[] {
  const packages = readdirSync(join(REPO, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `packages/${d.name}/src`);
  return ['apps/office/src', ...packages].flatMap((root) =>
    readdirSync(join(REPO, root), { recursive: true, encoding: 'utf8' })
      .map((file) => `${root}/${file.replaceAll('\\', '/')}`)
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
      .map((path) => parse(path, readFileSync(join(REPO, path), 'utf8')))
  );
}
