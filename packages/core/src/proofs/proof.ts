import { Effect } from "effect"

declare const NAME: unique symbol
declare const ABOUT: unique symbol

/** Named binds a value to an invariant name and allows reads only during its Effect execution. */
class Named<in out N, out A> {
  declare readonly [NAME]: (name: N) => N
  readonly #read: () => A

  constructor(read: () => A) {
    this.#read = read
    Object.freeze(this)
  }

  get value(): A {
    return this.#read()
  }
}

export type { Named }

/** named allocates fresh names per execution and expires them when use finishes, including interruption. */
export function named<A, Result, Error, Requirements>(
  a: A,
  use: <N>(a: Named<N, A>) => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements>
export function named<A, B, Result, Error, Requirements>(
  a: A,
  b: B,
  use: <N, M>(a: Named<N, A>, b: Named<M, B>) => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements>
export function named<A, B, C, Result, Error, Requirements>(
  a: A,
  b: B,
  c: C,
  use: <N, M, L>(a: Named<N, A>, b: Named<M, B>, c: Named<L, C>) => Effect.Effect<Result, Error, Requirements>,
): Effect.Effect<Result, Error, Requirements>
export function named<Result, Error, Requirements>(
  ...args: Array<unknown>
): Effect.Effect<Result, Error, Requirements> {
  const use = args.pop() as (...values: Array<unknown>) => Effect.Effect<Result, Error, Requirements>
  return Effect.suspend(() => {
    let active = true
    const values = args.map(
      (value) =>
        new Named(() => {
          if (!active) throw new Error("Named value used outside its Effect execution")
          return value
        }),
    )
    return Effect.suspend(() => use(...values)).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          active = false
        }),
      ),
    )
  })
}

class ProofValue<in out Kind extends string, in out About extends ReadonlyArray<unknown>> {
  declare readonly [ABOUT]: (about: About, kind: Kind) => About
  readonly #kind: Kind
  readonly #about: ReadonlyArray<{ readonly value: unknown }>

  constructor(kind: Kind, about: ReadonlyArray<{ readonly value: unknown }>) {
    this.#kind = kind
    this.#about = [...about]
  }

  get kind(): Kind {
    for (const named of this.#about) void named.value
    return this.#kind
  }
}

/** Proof records a checked fact; copying it loses the private identity required by services. */
export interface Proof<in out Kind extends string, in out About extends ReadonlyArray<unknown>>
  extends ProofValue<Kind, About> {}

type NameOf<T> = T extends Named<infer N, unknown> ? N : never
// biome-ignore lint/suspicious/noExplicitAny: names are opaque here; Proof pins them invariantly
type NamesOf<S extends ReadonlyArray<Named<any, unknown>>> = { -readonly [K in keyof S]: NameOf<S[K]> }

export interface Prover<Kind extends string> {
  readonly kind: Kind
  // biome-ignore lint/suspicious/noExplicitAny: names are opaque here; Proof pins them invariantly
  prove<const S extends ReadonlyArray<Named<any, unknown>>, Fields extends object = Record<never, never>>(
    about: S,
    fields?: Fields,
  ): Proof<Kind, NamesOf<S>> & Readonly<Fields>
}

/** defineProof creates a prover whose frozen results check their named values on every field read. */
export function defineProof<const Kind extends string>(kind: Kind): Prover<Kind> {
  return Object.freeze({
    kind,
    // biome-ignore lint/suspicious/noExplicitAny: names are opaque here; Proof pins them invariantly
    prove<const S extends ReadonlyArray<Named<any, unknown>>, Fields extends object = Record<never, never>>(
      about: S,
      fields?: Fields,
    ) {
      const proof = new ProofValue<Kind, NamesOf<S>>(kind, about)
      void proof.kind
      const data = Object.freeze({ ...fields })
      for (const key of Object.keys(data)) {
        if (key === "kind") throw new Error("Proof fields cannot replace kind")
        Object.defineProperty(proof, key, {
          enumerable: true,
          get: () => {
            void proof.kind
            return data[key as keyof typeof data]
          },
        })
      }
      return Object.freeze(proof) as Proof<Kind, NamesOf<S>> & Readonly<Fields>
    },
  })
}
