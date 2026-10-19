/**
 * Ghosts of Departed Proofs, Effect-native (docs/04-authorization-proofs.md).
 *
 * 1. `named(...)` gives values compile-time-only names, scoped to a callback.
 * 2. A prover in `proofs/` checks a fact and mints a `Proof` about those names.
 * 3. Sensitive service methods demand proofs about their exact arguments.
 */

declare const NAME: unique symbol
declare const ABOUT: unique symbol

/** A value of type A with a compile-time-only name N. Read the value with `.value`. */
export interface Named<in out N, out A> {
  readonly value: A
  readonly [NAME]: (n: N) => N
}

export function named<A, R>(a: A, k: <N>(a: Named<N, A>) => R): R
export function named<A, B, R>(a: A, b: B, k: <N, M>(a: Named<N, A>, b: Named<M, B>) => R): R
export function named<A, B, C, R>(
  a: A,
  b: B,
  c: C,
  k: <N, M, L>(a: Named<N, A>, b: Named<M, B>, c: Named<L, C>) => R,
): R
export function named(...args: Array<unknown>): unknown {
  const k = args.pop() as (...values: Array<unknown>) => unknown
  return k(...args.map((value) => Object.freeze({ value })))
}

/** Evidence that the fact `Kind` holds about the names in `About`. */
export interface Proof<in out Kind extends string, in out About extends ReadonlyArray<unknown>> {
  readonly kind: Kind
  readonly [ABOUT]: (about: About, kind: Kind) => About
}

type NameOf<T> = T extends Named<infer N, unknown> ? N : never
type NamesOf<S extends ReadonlyArray<Named<unknown, unknown>>> = { -readonly [K in keyof S]: NameOf<S[K]> }

export interface Prover<Kind extends string> {
  readonly kind: Kind
  // biome-ignore lint/suspicious/noExplicitAny: names are opaque here; Proof pins them invariantly
  prove<S extends Array<Named<any, unknown>>>(...about: S): Proof<Kind, NamesOf<S>>
}

/**
 * Creates the only thing that can mint proofs of `kind`. Call it in a file under `proofs/`
 * and never export the result.
 */
export function defineProof<const Kind extends string>(kind: Kind): Prover<Kind> {
  const proof = Object.freeze({ kind })
  // The only type assertion in the authorization system. Everything downstream is honest.
  // biome-ignore lint/suspicious/noExplicitAny: the single sanctioned assertion; see above
  return Object.freeze({ kind, prove: () => proof as unknown as Proof<Kind, any> })
}
