# Built once, built per team: avoiding cross-team state

*A design for keeping shared services from retaining one team's data, and the limits of what service tiers can enforce. Read [00 — One core, many entrypoints](./00-architecture.md) first for the vocabulary.*

---

## Implementation status

Passing team values per call and composing dependencies with Effect layers are implemented conventions. The tier markers, `processLayer`/`teamLayer` wrappers, and additional state/storage lint proposed below are **not implemented or configured**. D40/D41 record an approved design, not a completed check. See the [status inventory](./10-implementation-status.md).

The opening story and tier-check code are illustrative. The real broadcast sender uses the durable delivery mechanism in [07](./07-background-delivery.md).

## The broadcast that went out with the wrong footer

Consider a hypothetical cross-team bug in a marketing email sender.

Team A is a coffee roaster in Melbourne. Team B is a law firm in Sydney. On Tuesday morning both of them send a broadcast.

The law firm's 4,000 clients get a broadcast email that's mostly fine, except for the footer. The footer is the part the Spam Act requires: who sent this, their postal address, and how to unsubscribe. That footer reads *"Bean There Coffee Roasters, 12 Smith St, Fitzroy VIC"*. The unsubscribe link goes to the coffee roaster's unsubscribe screen.

So the law firm has just sent 4,000 emails that don't identify the law firm. Some of their clients clicked "unsubscribe" and unsubscribed from a coffee roaster they've never heard of. They will keep getting the law firm's email, which is exactly what the law exists to prevent.

No test failed. Nobody's review comment said "this leaks". Every type checked.

### How it got in

Sending mail at volume needs a long-running sender. `BroadcastSender` is built once per process, at boot. That tier prevents rebuilding a worker per request, but it cannot coordinate different servers. The implementation persists batches and claim tokens in Postgres, and `ProviderPacing` shares the provider account's allowance across processes. See [background delivery](./07-background-delivery.md) for the retry protocol and its limits; the simplified example below concerns team data, not delivery reliability.

Some weeks later, someone needs to add the compliance footer to each message. The footer comes from the team's sending settings. There's already a service for that, `TeamSendingSettings`, which holds one team's legal name, postal address, verified Resend sending domain and unsubscribe base URL. So they reach for it:

```diff
  static readonly layer = Layer.effect(BroadcastSender, Effect.gen(function* () {
    const mailer = yield* Mailer
+   const sending = yield* TeamSendingSettings
    const queue = yield* Queue.bounded<Outgoing>(10_000)
    const enqueue = Effect.fn("BroadcastSender.enqueue")(function* (message: Outgoing) {
-     yield* Queue.offer(queue, message)
+     yield* Queue.offer(queue, { ...message, footer: sending.footer })
    })
```

The compiler notices something: `BroadcastSender.layer` now requires `TeamSendingSettings`. The worker's layer no longer builds. So the developer does the obvious thing and provides it where the worker boots, built from the first job's team:

```ts
const workerLayer = BroadcastSender.layer.pipe(Layer.provide(TeamSendingSettings.layerFor(firstJob.teamId)))
```

The tests use a single fixture team, so they pass. Staging has one team, so it passes. The diff is a handful of lines and every one of them looks reasonable.

The bug is that `BroadcastSender` is built **once**, and it now holds something that belongs to **one team**. The first team to send a broadcast after boot has its footer captured inside the long-lived sender. Every other team borrows it until the next deploy.

This kind of bug has a name: a **captive dependency**. A long-lived thing has captured a short-lived one. It is quiet, it is type-correct, and it only appears once a second tenant arrives. A multi-tenant CRM has nothing *but* second tenants.

## The rule

Everything in Parley is built at one of three **tiers**: how long it lives.

| Tier | Built | Examples |
| --- | --- | --- |
| **process** | Once, at boot. Shared by every team and every request. | `SqlClient` (the Postgres pool), the Better-Auth instance, `Mailer` (wrapping the Resend client), `BroadcastSender`, config |
| **team** | Once per team. Carries one team's data or settings. | `TeamSendingSettings`, a per-team send quota, anything loaded with a `TeamId` and kept |
| **request** | Once per request. Gone when the request ends. | The `Principal`, every proof (`MemberOf`, `CanWriteRecords`, …) |

And one rule, which covers every leak in this post:

> **A longer-lived thing may not depend on a shorter-lived thing.**

So a process-tier thing may use only process-tier things. A team-tier thing may use team-tier and process-tier things. A request-tier thing may use anything.

The reverse direction is always fine and completely normal. A request uses the database pool on every query.

Effect does not check service lifetime categories. The design below proposes extra checks; until they exist, review must enforce this rule.

## What Effect already gives us

We're not starting from zero. Effect's `Layer` and `Context.Service` already do a lot of the work.

**Layers share construction within a build.** Effect memoizes layers by reference within the layer build that owns them. The application composition builds and retains the shared server runtime. A constant does not make a layer a singleton across independent runtimes. That makes "process tier" the natural default, with no singletons hand-rolled behind `let instance`.

**Requirements are visible.** A `Layer.Layer<BroadcastSender, never, Mailer | TeamSendingSettings>` says in its type what it needs to be built. That's why our story's diff *did* make the compiler speak up. The `R` channel is the "needs list" that the write-up this post is based on had to invent by hand.

**Service methods take arguments, not ambient context.** Our convention, from Effect's own guidance, is that service methods have `R = never`. Whatever a method needs per call, it takes as a parameter. That's the habit that makes everything later in this post work. Transaction combinators are an explicit exception: `MemberChanges.inTeam`, like `Database.transaction`, preserves its callback's requirements while executing it. It never stores that callback or its request context for later work.

### Where Effect stops

Effect told the developer "`BroadcastSender` now needs `TeamSendingSettings`". It did not say "and that's a mistake". To the type system, every requirement is just a requirement. `R` has no idea that one entry lives for the whole process and another for one team. So the compiler error was "provide this", and the developer did.

There are three ways the leak gets in even with Effect:

1. **Satisfying a team-tier requirement once, at boot.** That's our story: a team-tier layer is provided to a process-tier layer at the top of the app or worker. Tests do this constantly, because a test provides everything at the top, so they never notice.
2. **A cache inside a process-tier service.** A `Ref`, a `Map` or a plain `let` that holds "the footer" or "the quota", filled on first use. There's no requirement in `R` at all. The first team to call it fills it, and everyone after reads it.
3. **Module-level state.** A `const cache = new Map()` at the top of a file in `core/src/services/` is process-tier by definition, whatever you put in it.

Each of these needs a different guard. Let's take them in order.

## Parley's default: pass the team, don't hold it

*Decided (D39): a team-tier service needs explicit approval.*

Before adding any type machinery, the cheapest defense is to have almost nothing at the team tier.

In Parley, **the team is an argument, not a service.** Process-tier services don't hold a team. Each call is handed one as a *named, proven* value, a `TeamId` that has been through `proveMemberOf` inside a `named(...)` callback (see [04 — Proof, not promises](./04-authorization-proofs.md)):

```ts
// process tier: built once, holds no team
class TeamSendingSettings extends Context.Service<TeamSendingSettings, {
  readonly footerFor: <T>(team: Named<T, TeamId>, proof: CanSendEmail<any, T>) => Effect.Effect<Footer, TeamSendingNotConfigured>
}>()("@parley/TeamSendingSettings") {}
```

The example takes the team explicitly rather than capturing one team's settings. In the implemented sender, preparation persists each batch's resolved sender, footer, and content before dispatch. Explicit arguments reduce the opportunity for capture; they do not prevent a service from introducing an incorrectly keyed cache.

That gives us the shape for nearly all of v1 and v2:

- **Process tier:** every service: `Contacts`, `Companies`, `BroadcastSender`, `TeamSendingSettings`, the mailer. All built once, none holding team data.
- **Request tier:** the `Principal` and proofs. These are *values* passed down the call, not services in context.
- **Team tier:** reserved for things that really must hold one team's state across requests. For example, a per-team in-memory send-rate limiter, if we ever need one. Each one is a deliberate decision, made in review.

Why prefer an argument over a team-tier service? An argument shows up at every call site, and a proof checks it ([04](./04-authorization-proofs.md)). A team-tier service in context is invisible at the call site, and it's exactly what gets captured.

## Planned tier check

The proposed check would reject a process-tier layer requiring a marked team-tier or request-tier service. It does not exist in the source tree, and it cannot protect current callers.

> **Planned, uncompiled design sketch.** The types, service examples, diagnostics, and lint names in this section describe a possible implementation. They have not been compiled against the installed Effect version and are not current safeguards.

### Step 1: every service says which tier it's in

A tier you can't see is a tier you can't check. So each service class declares its tier with a type-only field. `declare` means nothing is emitted at runtime.

```ts
// packages/core/src/tiers.ts
export type Tier = "process" | "team" | "request"
export declare const TierMarker: unique symbol

class SqlClient extends Context.Service<SqlClient, SqlClientShape>()("@parley/SqlClient") {
  declare readonly [TierMarker]: "process"
}

class TeamSendRateLimiter extends Context.Service<TeamSendRateLimiter, LimiterShape>()("@parley/TeamSendRateLimiter") {
  declare readonly [TierMarker]: "team"
}
```

The service class is the type that appears in a layer's `R` channel, so its tier now travels with it into every requirement list.

### Step 2: say what each tier may use

```ts
type CanUse<T extends Tier> =
  T extends "process" ? "process" :
  T extends "team"    ? "process" | "team" :
  Tier

type TierOf<S> = S extends { readonly [TierMarker]: infer T } ? T : "unlabeled"
```

Services from Effect or other libraries (`HttpClient`, for example) have no marker. They come out as `"unlabeled"`, which is allowed anywhere and treated as process tier (D41). Third-party code that never opted in doesn't need labeling. Under this proposal, every service we write would receive a marker. The corresponding lint rule is also planned.

### Step 3: find the offenders

```ts
type WrongTier<R, T extends Tier> =
  R extends unknown                       // look at each type in the R union separately
    ? TierOf<R> extends CanUse<T> | "unlabeled" ? never : R
    : never
```

`WrongTier<R, "process">` is the union of the requirements a process-tier layer isn't allowed. If everything is legal, it's `never`, the empty union.

### Step 4: refuse to compile, and say why

TypeScript has no "raise an error with this message". The workaround is to make the parameter impossible to satisfy, and to make the impossible part *read like the error message*:

```ts
type TierCheck<R, T extends Tier> =
  [WrongTier<R, T>] extends [never]
    ? unknown
    : { readonly "built per team or per request, so a process-wide service cannot depend on it": WrongTier<R, T> }

export const processLayer = <A, E, R>(
  layer: Layer.Layer<A, E, R> & TierCheck<R, "process">,
): Layer.Layer<A, E, R> => layer

export const teamLayer = <A, E, R>(
  layer: Layer.Layer<A, E, R> & TierCheck<R, "team">,
): Layer.Layer<A, E, R> => layer
```

When nothing is wrong, the check is `unknown`, and `X & unknown` is just `X`, so it disappears. When something is wrong, the parameter needs a property whose *name is a sentence*. A `Layer` doesn't have it, so the call fails. The compiler prints the sentence and the offending service.

### The story, replayed

Under the proposal, each process-tier service would wrap its layer:

```ts
class BroadcastSender extends Context.Service<BroadcastSender, BroadcastSenderShape>()("@parley/BroadcastSender") {
  declare readonly [TierMarker]: "process"

  static readonly layer = processLayer(Layer.effect(BroadcastSender, Effect.gen(function* () {
    const mailer = yield* Mailer
    const sending = yield* TeamSendRateLimiter   // team tier
    // …
  })))
}
```

The intended diagnostic would reject the dependency before it is provided at boot:

```
Argument of type 'Layer<BroadcastSender, never, Mailer | TeamSendRateLimiter>' is not assignable to parameter of type
'Layer<…> & { readonly "built per team or per request, so a process-wide service cannot depend on it": TeamSendRateLimiter }'.
```

That error names the rule and the service that broke it. It shows up in the editor of whoever wrote the line, and they don't need to know the rule exists to understand what's wrong.

### Is it worth it?

The original write-up ended with this question, and it's a fair one. In a codebase that already exists, the advice was: list every cached value first, and only add the types if the list keeps growing.

D40 approves adding tier checks. Implementation remains outstanding; its cost and actual Effect signatures must be assessed against the existing services. Do not infer a marker or wrapper from that decision.

## Limits of the planned check

Be clear-eyed about this. The tier check looks at a layer's **requirements**. It doesn't look at what the code inside does.

| Leak | Caught by the tier check? | What catches it |
| --- | :-: | --- |
| A process-tier layer requires a team-tier service | Only if the planned check is implemented | Proposed `processLayer`; currently review |
| A `Ref` or `Map` inside a process-tier service caches one team's data on first use | ❌ | The "caches are keyed by `TeamId`" review-checklist item (D42) |
| Module-level `let` / `new Map()` in `core/src/services/` | ❌ | Review; the module-state lint is not configured |
| A proof or `Named` stored in a `Ref`, a layer or module state, so it outlives its request | ❌ by tiers | Runtime getters refuse named-value and proof-field reads after the `named` Effect finishes ([04](./04-authorization-proofs.md)); storage lint remains proposed |
| Closing over ambient "current team" state (a `FiberRef`, `AsyncLocalStorage`) | ❌ | Don't have any. There is no "current team" in Parley; the team is an argument. |
| Assertions that bypass the proposed check | ❌ | Review; explicit `any` is linted, but assertions are not generally banned |

### Planned GritQL rules

These are proposed rule names and requirements. None of the following rules is configured in Biome:

- **`service-declares-tier`**: every `Context.Service` class in `core` must declare `[TierMarker]`.
- **`layer-is-tiered`**: every `static readonly layer` in `core` must be wrapped in `processLayer(...)`, `teamLayer(...)` or (rarely) `requestLayer(...)`.
- **`no-module-state-in-services`**: no module-level `let`, `new Map`, `new Set`, `new WeakMap` or mutable arrays in `core/src/services/**` and `core/src/operations/**`. Constants are fine.
- **Process caches are keyed by `TeamId`** is a **review-checklist item**, not a lint rule (D42): GritQL can't reliably tell what a cache key means. The proposed `no-module-state-in-services` rule would make module state more visible; current review must inspect caches directly.
- **`no-proof-in-state`**: a proof or `Named` type may not appear inside `Ref.make`, `Layer.succeed`, or a module-level binding.
- **`no-type-assertion-in-core`**: no `as` (except `as const`) and no `any` in `core`, outside `proofs/` and `lib/ids.ts`. This also protects the proofs in [04](./04-authorization-proofs.md).

The proposed types and lint would cover some common mistakes. Until they are implemented and tested, service lifetime, cache keys, and captured request values remain review responsibilities. See the [configured rules](./10-implementation-status.md#configured-lint-inventory) for the narrower checks that actually run.

## None of this filters your SQL

Tiers stop a *long-lived object* from holding the wrong team. They do nothing to stop a query from reading the wrong team's rows:

```ts
db.select().from(contacts).where(eq(contacts.id, contactId))   // which team? any team.
```

That is a separate responsibility. The proof types in [04 — Proof, not promises](./04-authorization-proofs.md#sql-isolation-is-a-service-responsibility) constrain the named team and record values accepted by a service. They do not inspect SQL or automatically add predicates. Services are trusted to restrict reads, writes, joins, counts, and bulk selections to the proven team or a parent already located in it. Some internal lookup methods take raw IDs as part of implementing a prover; those queries need the same care.

Composite foreign keys protect the relationships declared with them, such as affiliations. They do not filter reads, and not every relationship in the current schema has a composite team foreign key. Some children inherit their team through their parent.

**Decided (D28, D166): RLS remains deferred.** A possible future policy could restrict rows to one transaction-local team while roles and scopes stay in core. That would be a backstop against omitted predicates, conditional on correct runtime privileges, team context, and policy coverage. It would need an audit of parent-owned children, pooled connections, migrations, background work and performance. Team columns make ownership visible; they do not make RLS adoption effortless.

For now the guard against SQL scoping mistakes is service review plus real Postgres regression tests. Tests deliberately put matching data in both teams and give a principal access to both, so membership denial cannot hide a missing predicate. Passing those tests is evidence for the cases exercised, not proof that every future query is safe.

## Implemented service lifetimes

These lifetimes follow the current application composition and method signatures. They are not compiler-read tier metadata.

| Service or value | Lifetime | Team handling |
| --- | --- | --- |
| `Database` and `NodePgPool` | Shared infrastructure in the built runtime | Own configuration and connection lifetime; do not retain a current team |
| `BetterAuth` and `Authenticator` | Shared services | Look up identity and credentials per call |
| `Contacts`, `Companies`, `Members`, and the other data services | Shared services | Take the team, resource, and relevant proofs per call |
| `Sending` | Shared service | Reads sender and sending-domain data for the requested team |
| `Mailer` | Shared service | Holds provider configuration; receives message-specific sender and content data |
| `BroadcastSender` and `ProviderPacing` | Shared services coordinated through Postgres | Batch rows identify their broadcast and team; pacing keys the provider account |
| `Imports` and `ImportRunner` | Shared services | Import rows identify their team and initiating principal; authorization is rebuilt for work rather than retained as a proof |
| `RateLimiter` | Shared service backed by keyed Postgres counts, with its documented fallback | Keys identify the request budget; there is no one-team instance captured at boot |
| `Principal`, named values, and proofs | Supplied during an operation or named Effect execution | Named-value and proof-field access expires with its execution |

The proposed team tier remains available as a design category if a future service genuinely needs one team's state across requests. Such a service is not made safe merely by declaring its intended lifetime in documentation.

## Further reading

- Mark Seemann, [*Captive Dependency*](https://blog.ploeh.dk/2014/06/02/captive-dependency/) (2014). The original name for this bug, written for .NET DI containers.
- The opencode implementation that inspired our check. Their tiers are data (`{ location: ["global"], global: [] }`) rather than a hard-coded `CanUse`. That's worth copying if we ever add a fourth tier.
- The `{ "sentence as property name": Offender }` trick, used in Drizzle and tRPC for the same reason we use it: TypeScript has no custom error messages.

## Open questions

Resolved: D39 (team as argument), D40 (tier-check design approved; implementation outstanding), D41 (untiered third-party services allowed anywhere, as process tier), D42 (team-keyed caches are a review-checklist item) and D50 (`Mailer` is a pluggable process-tier service with Resend as the default). See the [decisions log](./decisions.md).

The earlier Q-T5 store question is resolved by D157's shared, keyed Postgres limiter. That choice is process-tier by convention and does not implement the type-level tier check.
