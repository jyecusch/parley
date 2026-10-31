# Built once, built per team: making cross-team leaks a compile error

*How Parley stops one team's data from reaching another, using the tier of each thing we build. Read [00 — One core, many entrypoints](./00-architecture.md) first for the vocabulary.*

---

## The broadcast that went out with the wrong footer

It's a few months from now. Parley v2 sends marketing email.

Team A is a coffee roaster in Melbourne. Team B is a law firm in Sydney. On Tuesday morning both of them send a broadcast.

The law firm's 4,000 clients get a broadcast email that's mostly fine, except for the footer. The footer is the part the Spam Act requires: who sent this, their postal address, and how to unsubscribe. That footer reads *"Bean There Coffee Roasters, 12 Smith St, Fitzroy VIC"*. The unsubscribe link goes to the coffee roaster's unsubscribe screen.

So the law firm has just sent 4,000 emails that don't identify the law firm. Some of their clients clicked "unsubscribe" and unsubscribed from a coffee roaster they've never heard of. They will keep getting the law firm's email, which is exactly what the law exists to prevent.

No test failed. Nobody's review comment said "this leaks". Every type checked.

### How it got in

Sending mail at volume needs one thing per process: a sender that batches messages and keeps within Resend's rate limit. You don't want one of those per request. Many senders would each think they own the whole rate limit. So `BroadcastSender` is built once, at boot, and shared. That's correct.

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

Stated like that, the rule is obvious. Nothing checks it, though. The rest of this post is about getting the compiler and the linter to check it, so a reviewer doesn't have to.

## What Effect already gives us

We're not starting from zero. Effect's `Layer` and `Context.Service` already do a lot of the work.

**Layers are built once.** A `Layer` stored in a constant is memoized by reference. Built into the app layer, it's constructed once and shared. That makes "process tier" the natural default, with no singletons hand-rolled behind `let instance`.

**Requirements are visible.** A `Layer.Layer<BroadcastSender, never, Mailer | TeamSendingSettings>` says in its type what it needs to be built. That's why our story's diff *did* make the compiler speak up. The `R` channel is the "needs list" that the write-up this post is based on had to invent by hand.

**Service methods take arguments, not ambient context.** Our convention, from Effect's own guidance, is that service methods have `R = never`. Whatever a method needs per call, it takes as a parameter. That's the habit that makes everything later in this post work.

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

Then `BroadcastSender` doesn't need `TeamSendingSettings` at build time. Each outgoing message arrives already carrying its own footer, looked up for its own team by the operation that queued it. Our story's bug can't be written, because there's nothing at the team tier to capture.

That gives us the shape for nearly all of v1 and v2:

- **Process tier:** every service: `Contacts`, `Companies`, `BroadcastSender`, `TeamSendingSettings`, the mailer. All built once, none holding team data.
- **Request tier:** the `Principal` and proofs. These are *values* passed down the call, not services in context.
- **Team tier:** reserved for things that really must hold one team's state across requests. For example, a per-team in-memory send-rate limiter, if we ever need one. Each one is a deliberate decision, made in review.

Why prefer an argument over a team-tier service? An argument shows up at every call site, and a proof checks it ([04](./04-authorization-proofs.md)). A team-tier service in context is invisible at the call site, and it's exactly what gets captured.

## Making the rule a compile error

The default above makes the leak rare. The check below makes it **impossible in the form the story took**: a process-tier layer can't require a team-tier or request-tier service.

> **Design sketch.** The TypeScript below is plausible and follows the same pattern as the original write-up (and Drizzle and tRPC). It still has to be compiled against Effect v4's real `Layer` and `Context.Service` types during implementation. Expect small adjustments.

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

Services from Effect or other libraries (`HttpClient`, for example) have no marker. They come out as `"unlabeled"`, which is allowed anywhere and treated as process tier (D41). Third-party code that never opted in doesn't need labeling. Every service *we* write gets a marker, and a lint rule (below) enforces that.

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

Every process-tier service wraps its layer:

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

and the compiler stops the diff on the spot, before anyone gets to "just provide it at boot":

```
Argument of type 'Layer<BroadcastSender, never, Mailer | TeamSendRateLimiter>' is not assignable to parameter of type
'Layer<…> & { readonly "built per team or per request, so a process-wide service cannot depend on it": TeamSendRateLimiter }'.
```

That error names the rule and the service that broke it. It shows up in the editor of whoever wrote the line, and they don't need to know the rule exists to understand what's wrong.

### Is it worth it?

The original write-up ended with this question, and it's a fair one. In a codebase that already exists, the advice was: list every cached value first, and only add the types if the list keeps growing.

**Parley is greenfield, and that changes the maths.** Adding a tier marker costs one line per service, written once, when the service is created. Retrofitting it later means reviewing every module-level `const`. And our product roadmap, marketing email with per-team sending, legal footers and quotas, is exactly the area where team-tier state wants to appear. So we label from day one and wrap every layer (D40).

## What the types don't catch

Be clear-eyed about this. The tier check looks at a layer's **requirements**. It doesn't look at what the code inside does.

| Leak | Caught by the tier check? | What catches it |
| --- | :-: | --- |
| A process-tier layer requires a team-tier service | ✅ | `processLayer` |
| A `Ref` or `Map` inside a process-tier service caches one team's data on first use | ❌ | The "caches are keyed by `TeamId`" review-checklist item (D42) |
| Module-level `let` / `new Map()` in `core/src/services/` | ❌ | Lint |
| A proof or `Named` stored in a `Ref`, a layer or module state, so it outlives its request | ❌ by tiers | Runtime getters refuse named-value and proof-field reads after the `named` Effect finishes ([04](./04-authorization-proofs.md)); storage lint remains proposed |
| Closing over ambient "current team" state (a `FiberRef`, `AsyncLocalStorage`) | ❌ | Don't have any. There is no "current team" in Parley; the team is an argument. |
| `as any` / `as Layer.Layer<…>` to get past the check | ❌ | Lint bans assertions in `core/` |

### GritQL rules

These sit in Biome with the rest of our lint rules, scoped to `packages/core/src/**`:

- **`service-declares-tier`**: every `Context.Service` class in `core` must declare `[TierMarker]`.
- **`layer-is-tiered`**: every `static readonly layer` in `core` must be wrapped in `processLayer(...)`, `teamLayer(...)` or (rarely) `requestLayer(...)`.
- **`no-module-state-in-services`**: no module-level `let`, `new Map`, `new Set`, `new WeakMap` or mutable arrays in `core/src/services/**` and `core/src/operations/**`. Constants are fine.
- **Process caches are keyed by `TeamId`** is a **review-checklist item**, not a lint rule (D42): GritQL can't reliably tell what a cache key means. The `no-module-state-in-services` rule above pushes every cache into an explicit service, where review can see it.
- **`no-proof-in-state`**: a proof or `Named` type may not appear inside `Ref.make`, `Layer.succeed`, or a module-level binding.
- **`no-type-assertion-in-core`**: no `as` (except `as const`) and no `any` in `core`, outside `proofs/` and `lib/ids.ts`. This also protects the proofs in [04](./04-authorization-proofs.md).

Together, the types close the *normal* way to reach across tiers, which is asking for a dependency. Lint closes the obvious workarounds. What remains looks strange enough to stand out in review.

## None of this filters your SQL

Tiers stop a *long-lived object* from holding the wrong team. They do nothing to stop a query from reading the wrong team's rows:

```ts
db.select().from(contacts).where(eq(contacts.id, contactId))   // which team? any team.
```

That's a different problem with a different answer, and it belongs to [04 — Proof, not promises](./04-authorization-proofs.md). In short: services never take a raw `TeamId`. They take a named team plus a proof about it, and every query they build is filtered by that team. A contact that exists in another team is simply `ContactNotFound`.

There's a second layer we could add underneath: **Postgres row-level security**. Each transaction sets `app.team_id`, and a policy on every tenant table only allows rows with that `team_id`. It's defense in depth: if a service bug ever forgot the `where`, the database would still refuse. It has real costs, though. Every query has to run in a transaction that sets the variable. Pooled connections need careful handling. Migrations and admin tooling need a bypass role. **Decided (D28): later.** v1 relies on proofs plus `(team_id, id)` foreign keys, and every tenant table carries `team_id`, so adding row-level security later needs policies and plumbing, not a data migration.

## Parley's services and their tiers

*Proposed tiers for everything we know we'll build in v1 and v2.*

| Service | Tier | Why |
| --- | --- | --- |
| `AppConfig` | process | Read once from the environment |
| `SqlClient` (Drizzle + pool) | process | One pool for everyone |
| `Auth` (Better-Auth instance) | process | Stateless with respect to teams; sessions are looked up per request |
| `PrincipalResolver` | process | Turns a session cookie or API key into a `Principal`; holds nothing per team |
| `Contacts`, `Companies` | process | Take a named, proven team on every call |
| `Members`, `ApiKeys`, `ServiceAccounts` | process | Same |
| `Activity` | process | Each entry carries its own team and principal |
| `Mailer`: a pluggable interface; the default implementation wraps the Resend client (D50) | process | One client, one Resend credential for our Resend account. Per-team things (verified sending domain, footer legal name and address) are team **data**, looked up per call, never held here |
| `BroadcastSender` (batching, Resend rate limit) | process | Resend's rate limit applies to our account, not per team |
| `Imports`, `ImportRunner` (D135) | process | Each import row carries its own team and the principal who started it; the runner rebuilds that principal for every part and checks their membership and permissions again, so nothing is held between parts |
| `TeamSendingSettings` | process | A lookup by named team, not a holder of one team's settings |
| `Templates`, `Drafts`, and the v2 contact-set services (names not yet defined) | process | Team passed per call |
| `Subscriptions` (unsubscribe state) | process | Keyed by team + recipient |
| `TeamSendRateLimiter` (only if we need per-team in-memory limits) | **team** | Holds one team's counters. The single justified team-tier service so far, and maybe not even that: a Postgres- or Redis-backed limiter keyed by `TeamId` would be process tier. |
| `Principal`, proofs | **request** | Values, never services, never stored. One exception: an import stores who started it (D135), and its runner checks again that they may still write before each part |

Notice how short the team-tier section is. That's on purpose.

## Further reading

- Mark Seemann, [*Captive Dependency*](https://blog.ploeh.dk/2014/06/02/captive-dependency/) (2014). The original name for this bug, written for .NET DI containers.
- The opencode implementation that inspired our check. Their tiers are data (`{ location: ["global"], global: [] }`) rather than a hard-coded `CanUse`. That's worth copying if we ever add a fourth tier.
- The `{ "sentence as property name": Offender }` trick, used in Drizzle and tRPC for the same reason we use it: TypeScript has no custom error messages.

## Open questions

Resolved: D39 (team as argument), D40 (tier check from day one), D41 (untiered third-party services allowed anywhere, as process tier), D42 (team-keyed caches are a review-checklist item) and D50 (`Mailer` is a pluggable process-tier service with Resend as the default). See the [decisions log](./decisions.md).

Deferred to v2 design:

- **Q-T5: per-team send rate limiting.** An in-memory team-tier limiter, or a shared store (Postgres or Redis) keyed by `TeamId` that stays process tier? The second keeps the team tier empty.
