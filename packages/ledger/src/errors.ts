// An error whose message was written in the code, so an error report may keep
// it. Every other message can hold what the owner typed, and leaves withheld.
// The class stays private, so only fixedError can make one, and its type
// takes only a string literal: a template or a variable does not compile.
//
// Office code imports this as @oddboro/ledger/errors and ledger code as
// ./errors.ts. Both resolve to this one file, which isFixedError needs.

class OddboroError extends Error {}

// `Record<M, 1>` has a required key only when M is a literal, so a plain
// `string` or a template type such as `No such ${string}` becomes never.
type Literal<M extends string> = {} extends Record<M, 1> ? never : M;

export function fixedError<const M extends string>(message: Literal<M>): Error {
  return new OddboroError(message);
}

export const isFixedError = (e: unknown): e is Error => e instanceof OddboroError;
