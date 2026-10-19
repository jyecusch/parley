# Proof, not promises: authorization the compiler can check

*How Parley makes "did anyone actually check this?" a question the type checker answers, for every call site, including the ones nobody has written yet.*

---

Here is the most common authorization bug in the world. You've written it. I've written it. It looks perfectly fine:

```ts
async function updateContact(req, res) {
  await assertCanWrite(req.user.id, req.params.teamId)         // throws 403
  await db.contacts.update(req.params.contactId, req.body)    // nothing connects this line to the one above
  res.sendStatus(204)
}
```

Read it again slowly. The check is about the **team** in the URL. The write is about the **contact** in the URL. Nothing says the contact belongs to that team. Send `teamId` for a team you're a member of and `contactId` for a contact in someone else's team, and you've just edited a stranger's CRM.

It gets worse, and in Parley it would get worse in three specific ways.

**The agent entrypoint.** Parley is agent-first. Jane gives her agent an API key with only the `records:read` scope, because she wants it to research, not edit. The web route checks Jane's *role*, which allows writing. The MCP tool, written later by someone else, copies that check. Neither one looks at the API key's *scopes*. Jane's "read-only" agent can write.

**The team switch.** Jane is a member of three teams. She switches from "Acme" to "Side Project" in one tab while a request from another tab is still in flight. Any code that reads "the current team" from somewhere ambient, instead of from the request, can check permissions in one team and write in the other.

**The copy.** We will have a web UI, an HTTP API and an MCP server, and one day a CLI. If each entrypoint carries its own copy of "check, then act", we have four copies of every authorization rule. When the rule changes ("only admins can delete companies"), one copy gets missed. Nobody notices, because every test exercises the copy it was written for.

None of these is a typo. Each comes from the same structural flaw: **the check produces a boolean, and a boolean says nothing about what it was checked for.** Robert Harper called this *[boolean blindness](https://existentialtype.wordpress.com/2011/03/15/boolean-blindness/)*. `assertCanWrite` returns nothing, or `true`. The write function has no way to ask *"checked for whom, in which team, for which contact?"*

This post is about replacing the boolean with a **proof**: a value that says exactly what was checked, about exactly which values, and that the sensitive function demands as an argument. Forget the check and the code doesn't compile. Check the wrong team and the code doesn't compile. Pass a read permission where a write is needed and the code doesn't compile.

## Where this idea comes from

The technique is called **Ghosts of Departed Proofs**. Matt Noonan introduced it in Haskell in [a 2018 paper](https://kataskeue.com/gdp.pdf) (and the [`gdp`](https://hackage.haskell.org/package/gdp) library). Ollie Charles applied it to authorization in [*Who Authorized These Ghosts!?*](https://blog.ocharles.org.uk/posts/2019-08-09-who-authorized-these-ghosts.html), which is the direct ancestor of this post. Guillermo Rauch's [`gdp-ts`](https://github.com/rauchg/gdp-ts) brought it to TypeScript with a small library, a lint preset and a set of excellent examples.

We are **not** using the `gdp-ts` library. We're writing our own Effect-native version of about 100 lines. The ideas, the variance tricks and most of the vocabulary come straight from `gdp-ts`. What changes is that our provers return an `Effect` that **fails with a specific, typed error** instead of returning `null`. That fits [Errors are data](./01-errors-are-data.md): "you can't do that" is never one generic 403. It is `RoleLacksPermission { needed: "records:write" }`, or `ApiKeyScopeExcludes { needed: "records:write" }`, and those have different fixes and different messages.

## The rule, in one sentence

> **Entrypoints authenticate. Proofs authorize. Services demand proofs.**

- An **entrypoint** (web, HTTP, MCP, CLI) turns a session cookie or an API key into a `Principal`, which says *who is knocking*. That's all it does. It contains no `if (role === …)` and no permission names. It couldn't use them anyway.
- **`core/src/proofs/`** is the *only* directory that decides authorization. Each file checks one fact and mints a proof of it.
- **Services** (the code that touches the database) take proofs as arguments. They never perform checks. They just refuse to compile without the proof.

Everything else in this post is how we make the compiler enforce that sentence.

## Three ideas, in order

### 1. Name the values

A `ContactId` is a branded string. That stops you passing an `TeamId` where a `ContactId` belongs. But it can't tell *this* contact from *that* contact: two `ContactId`s have the same type.

So we give values a **name**, a type that exists only at compile time and is different for every value we name:

```ts
named(principal, input.teamId, input.contactId, (principal, team, contact) =>
  // in here: principal is Named<P, Principal>
  //          team      is Named<T, TeamId>
  //          contact   is Named<C, ContactId>
  // P, T and C are fresh, unique types that nothing else can produce
)
```

At runtime `named` does almost nothing. It wraps each value in a frozen `{ value }` and calls the callback. All the work happens in the type checker: because the callback is *generic* (`<P, T, C>(…) => …`), TypeScript must treat `P`, `T` and `C` as opaque, distinct types. Two calls to `named`, or two values in one call, can never be confused.

The callback returns an `Effect`, so naming slots straight into Effect code.

### 2. Prove facts about names

A proof is a value of type `Proof<Kind, About>`. For example, `CanWriteRecords<P, T>` means *"principal `P` may write records in team `T`"*. It's minted by a **prover**, and each prover lives in exactly one file in `proofs/`. That file doesn't export the prover, so it's the only place in the codebase that can create that kind of proof.

```ts
// core/src/proofs/can-write-records.ts
const CanWriteRecords = defineProof("CanWriteRecords")           // NOT exported
export interface CanWriteRecords<P, T> extends Proof<"CanWriteRecords", [P, T]> {}

export const proveCanWriteRecords = <P, T>(member: MemberOf<P, T>) =>
  requirePermission(member, "records:write").pipe(               // fails: RoleLacksPermission | ApiKeyScopeExcludes
    Effect.as(CanWriteRecords.prove(member.principal, member.team)),
  )
```

At runtime a proof is a frozen `{ kind: "CanWriteRecords" }` object. It's a ghost: it carries no data that matters. Its value is entirely in its *type*, which records which names it is about.

### 3. Demand proofs

Sensitive functions take proofs about their exact arguments:

```ts
readonly update: <P, T, C>(
  target: ContactInTeam<C, T>,         // this contact, proven to live in team T
  patch: ContactPatch,
  access: CanWriteRecords<P, T>,      // write permission, proven for THE SAME team T
) => Effect.Effect<Contact, ContactEmailTaken>
```

The shared `T` is the whole trick. The contact's proof and the permission's proof must be about **the same team**, or the call doesn't type-check. That's the bug from the top of this post, made impossible.

## The module

This is the whole thing. It lives in `@parley/core` at `core/src/proofs/proof.ts`, and I've compiled every snippet in this post against Effect 4.0.5 with `tsc --strict`:

```ts
declare const NAME: unique symbol
declare const ABOUT: unique symbol

/** A value of type A with a compile-time-only name N. */
export interface Named<in out N, out A> {
  readonly value: A
  readonly [NAME]: (n: N) => N          // phantom; never assigned
}

export function named<A, R>(a: A, k: <N>(a: Named<N, A>) => R): R
export function named<A, B, R>(a: A, b: B, k: <N, M>(a: Named<N, A>, b: Named<M, B>) => R): R
export function named<A, B, C, R>(
  a: A, b: B, c: C,
  k: <N, M, L>(a: Named<N, A>, b: Named<M, B>, c: Named<L, C>) => R,
): R
export function named(...args: Array<unknown>): unknown {
  const k = args.pop() as (...xs: Array<unknown>) => unknown
  return k(...args.map((value) => Object.freeze({ value })))
}

/** Proof that fact Kind holds about the names in About. */
export interface Proof<in out Kind extends string, in out About extends ReadonlyArray<unknown>> {
  readonly kind: Kind
  readonly [ABOUT]: (about: About, kind: Kind) => About   // phantom; never assigned
}

export interface Prover<Kind extends string> {
  readonly kind: Kind
  prove<S extends Array<Named<any, any>>>(...about: S): Proof<Kind, NamesOf<S>>
}

export function defineProof<const Kind extends string>(kind: Kind): Prover<Kind> {
  const proof = Object.freeze({ kind })
  // The only type assertion in the authorization system. Everything downstream is honest.
  return Object.freeze({ kind, prove: () => proof as unknown as Proof<Kind, any> })
}
```

Two type-system details make this sound. You don't need to understand them to use it, but here they are in plain words.

**Variance (`in out`).** By default TypeScript allows some substitutions between related types: a `Named<never, X>` might be accepted where a `Named<P, X>` is wanted. `in out` says "this type parameter must match *exactly*". Without it a name could be faked with `never` or `unknown`. The phantom `(n: N) => N` field makes the type's *structure* enforce the same rule, because TypeScript sometimes ignores annotations and compares shapes instead. (`gdp-ts` explains this in detail.)

**No escape.** A name only means something inside its callback. If you try to return a `Named` or a proof *out* of `named(…)`, TypeScript would have to give the result type `Named<unknown, …>`. Invariance forbids that, so it's a compile error. This is what keeps proofs **request-scoped**: you can't stash one away and reuse it in the next request.

## Parley's proof catalog (v1 proposal)

Here's every fact Parley v1 needs to prove. Letters: `P` for a principal, `T` for a team, `C` for a contact, `K` for a company.

| Proof | Means | Minted from | Can fail with |
| --- | --- | --- | --- |
| `MemberOf<P, T>` | P is a current member of team T. Carries what the check found: `role` and the effective `permissions`. | **Database**: one member lookup | `NotATeamMember`, `ApiKeyNotValidForTeam` |
| `CanReadRecords<P, T>` | P may read contacts and companies in T | `MemberOf` (pure) | `RoleLacksPermission`, `ApiKeyScopeExcludes` |
| `CanWriteRecords<P, T>` | P may create and edit them | `MemberOf` (pure) | same |
| `CanDeleteRecords<P, T>` | P may delete and restore them | `MemberOf` (pure) | same |
| `CanManageFields<P, T>` | create, edit and delete custom fields | `MemberOf` (pure) | same |
| `CanManageMembers<P, T>` | invite, remove, change roles | `MemberOf` (pure) | same |
| `CanManageServiceAccounts<P, T>` | service accounts and their API keys | `MemberOf` (pure) | same |
| `CanManageTeam<P, T>` | rename, billing, delete the team | `MemberOf` (pure) | same |
| `ContactInTeam<C, T>` | contact C exists and belongs to T | **Database**, and requires read access to T | `ContactNotFound` |
| `CompanyInTeam<K, T>` | company K exists and belongs to T | **Database**, and requires read access to T | `CompanyNotFound` |
| `ContactRestorable<C, T>` / `CompanyRestorable<K, T>` | the record belongs to T, is deleted, and hasn't been purged | **Database**, and requires read access to T | `ContactNotFound` / `CompanyNotFound`, `ContactNotDeleted` / `CompanyNotDeleted` *(proposed)* |
| `CustomFieldInTeam<F, T>` | custom field F exists and belongs to T | **Database**, and requires read access to T | `CustomFieldNotFound` |

The `…InTeam` proofs only ever find records that haven't been deleted. A deleted contact is `ContactNotFound` to every operation except restore, which asks for `ContactRestorable` instead. Once a record is purged, it's `ContactNotFound` to restore too.

Two design choices are buried in that table.

**Proofs make proofs.** Only `MemberOf` and the `…InTeam` proofs touch the database. Every `Can…` proof is derived from a `MemberOf` by a *pure* function, with no query. An operation pays for one member lookup, then derives whatever permissions it needs for free. (`gdp-ts` describes this pattern as a proof that carries what the check discovered; `MemberOf` carries the role and permission set the derivations read.)

**No existence oracle.** If you aren't a member of a team, we don't tell you whether it exists: `NotATeamMember` covers both cases (D35). If a contact is in *another* team, you get `ContactNotFound`, exactly as if it didn't exist, even if you're a member of that other team too (D37). Someone probing ids learns nothing. The check is also ordered: you need read access to team `T` *before* we'll even look up whether contact `C` is in it.

### One function computes effective permissions

The [architecture overview](./00-architecture.md) defines *effective permissions = role permissions ∩ scopes*. That intersection is computed in **exactly one function**, private to `proofs/member-of.ts`. So is the order of the checks, which matters because the two errors have different fixes:

```ts
// core/src/proofs/permissions.ts: the only code that answers "is this permission granted?"
export const requirePermission = (member: MemberOf<any, any>, needed: Permission) => {
  if (!member.rolePermissions.has(needed)) {
    return Effect.fail(new RoleLacksPermission({ needed, role: member.role }))
    // userMessage: "Your role in Acme can't manage service accounts. A team admin can do this, or change your role."
  }
  if (member.scopes !== "unrestricted" && !member.scopes.has(needed)) {
    return Effect.fail(new ApiKeyScopeExcludes({ needed }))
    // userMessage: "This API key can only read records. Create one that can also edit them in Settings → API keys."
  }
  return Effect.void
}
```

Role and scope are separate errors because a user needs to know *which* one to fix. One sends you to an admin; the other sends you to your API key settings. That's the [error messages post](./02-writing-error-messages.md) in action.

**Permissions are explicit (D27).** No permission implies another. `records:write` doesn't include `records:read`, and `records:delete` includes neither. An operation proves every permission it uses: `contacts.update` proves read access (to find the contact) *and* write access (to change it). Every role grants all three record permissions, so this only matters for API key scopes. An API key gets exactly the permissions written on it, nothing hidden in an implication table, and the scope list on the API key settings screen is the whole truth.

## Three kinds of principal, one prover

Parley has three kinds of principal (see [00](./00-architecture.md)):

```ts
type Principal =
  | UserSession      // Jane in the web app
  | UserApiKey            // Jane's agent, using an API key Jane created: Jane's identity, bound to one team, limited by scopes
  | ServiceAccountApiKey  // an agent using the API key of "Support Bot", a service account that is a member in its own right
```

A naive design writes three authorization paths. We write one. `proveMemberOf` is the **only** function that knows principals come in kinds, and it reduces all three to two questions: *which member row?* and *which scope ceiling?*

```ts
// core/src/proofs/member-of.ts
export const proveMemberOf = <P, T>(principal: Named<P, Principal>, team: Named<T, TeamId>) =>
  Effect.gen(function* () {
    const p = principal.value
    if (p._tag === "UserApiKey" && p.teamId !== undefined && p.teamId !== team.value) {
      return yield* new ApiKeyNotValidForTeam()                      // an API key created for Acme can't touch Side Project
    }
    const member = yield* members.find(subjectOf(p), team.value)  // UserSession/UserApiKey: the user's id; ServiceAccountApiKey: the service account's id
    if (!member) return yield* new NotATeamMember()                 // also when the team doesn't exist
    const proof: MemberOf<P, T> = {
      ...MemberOfProver.prove(principal, team),
      principal, team,
      role: member.role,
      rolePermissions: expand(ROLE_PERMISSIONS[member.role]),
      scopes: p._tag === "UserSession" ? "unrestricted" : expand(p.scopes),
    }
    return proof
  })
```

From here on, nothing in the codebase knows or cares whether a user or an agent is acting. The web entrypoint, the HTTP entrypoint and the MCP entrypoint all produce a `Principal` and hand it to the same operation. **No entrypoint has authorization code, because no entrypoint can.**

**Decided (D18): service accounts are Better-Auth users.** Each service account is stored as a Better-Auth *user* with `kind: "service-account"` and an ordinary member row in its team. Then `members.find` is one query for all three principal kinds, roles work identically, and removing a service account from a team uses the same code as removing a user. The cost is that every screen listing members must decide whether to show service accounts, and service accounts must never be able to sign in with a password.

## Services that demand proofs

Here's the `Contacts` service contract. It's the only code that can query contacts, because only `@parley/core` can import `@parley/db`:

```ts
export class Contacts extends Context.Service<Contacts, {
  readonly list: <P, T>(team: Named<T, TeamId>, query: ContactQuery, access: CanReadRecords<P, T>)
    => Effect.Effect<ContactPage>

  readonly create: <P, T>(team: Named<T, TeamId>, input: NewContact, access: CanWriteRecords<P, T>)
    => Effect.Effect<Contact, ContactEmailTaken | InputRejected>

  readonly update: <P, T, C>(target: ContactInTeam<C, T>, patch: ContactPatch, access: CanWriteRecords<P, T>)
    => Effect.Effect<Contact, ContactEmailTaken | InputRejected>

  readonly affiliate: <P, T, C, K>(
    target: ContactInTeam<C, T>, company: CompanyInTeam<K, T>, title: AffiliationTitle | undefined, access: CanWriteRecords<P, T>,
  ) => Effect.Effect<Affiliation>

  readonly delete: <P, T, C>(target: ContactInTeam<C, T>, access: CanDeleteRecords<P, T>)
    => Effect.Effect<void>

  readonly restore: <P, T, C>(target: ContactRestorable<C, T>, access: CanDeleteRecords<P, T>)
    => Effect.Effect<Contact, ContactEmailTaken>
}>()("@parley/core/Contacts") {}
```

Look at what each signature rules out.

- **`list`** takes a named team and a read proof about that same team. Inside, *every* query is filtered with `where(eq(contacts.teamId, team.value))`, and deleted contacts are excluded. Because the team can only come from the named value, there's no other team id lying around to put there.
- **`create`**: `NewContact` has **no `teamId` field**. The team comes only from the named team that the write proof is about. A client can't sneak `"teamId": "someone-else"` into a request body, because the field doesn't exist to be read.
- **`update` and `delete`** take a `ContactInTeam<C, T>` (which carries the named contact *and* the named team) plus a permission proof about the same `T`. `delete` is a soft delete: the contact disappears at once and its email addresses are freed, but it can be restored for 30 days.
- **`restore`** takes a `ContactRestorable<C, T>`, a different proof from `ContactInTeam`, because it is about a *deleted* contact. It can fail with `ContactEmailTaken` if someone reused one of its addresses while it was deleted.
- **`affiliate`** is the subtle one. An affiliation crosses two records. The types require that the contact *and* the company are both proven to be in `T`. You cannot affiliate Acme's contact with Globex's company. (The database backs this up with composite foreign keys, `(team_id, contact_id) → contacts(team_id, id)` and `(team_id, company_id) → companies(team_id, id)`. As `gdp-ts` puts it, the constraint stops bad rows and the proof stops bad code paths from being written.) Whether affiliating twice is a no-op or an error is still open; see [01](./01-errors-are-data.md).

### And the operation that ties it together

This is the `contacts.update` operation from [00](./00-architecture.md): the one place the check-then-act sequence is written, shared by every entrypoint.

```ts
// core/src/operations/contacts.update.ts
export const update = Effect.fn("contacts.update")(function* (principal: Principal, input: UpdateContactInput) {
  const contacts = yield* Contacts
  return yield* named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const member = yield* proveMemberOf(principal, team)               // NotATeamMember | ApiKeyNotValidForTeam
      const canRead = yield* proveCanReadRecords(member)                 // RoleLacksPermission | ApiKeyScopeExcludes
      const canWrite = yield* proveCanWriteRecords(member)               // RoleLacksPermission | ApiKeyScopeExcludes
      const target = yield* proveContactInTeam(team, contact, canRead)   // ContactNotFound (other team, or deleted)
      return yield* contacts.update(target, input.patch, canWrite)       // ContactEmailTaken | InputRejected
    }))
})
```

The operation's error union is computed by the compiler: every error any step can raise. That union is what every entrypoint must map (see [01](./01-errors-are-data.md)).

## What the compiler catches

These are real errors from `tsc --strict` against a compiled sketch of the code above (the sketch's `list` has no `query` argument, so the argument count in the third error is adjusted to match this post's signature). Inside a `named(principal, teamA, teamB, (principal, a, b) => …)` block, where `readA` and `writeA` were proven for team `a`:

```ts
yield* contacts.list(b, query, readA)
// error TS2345: Argument of type 'CanReadRecords<N, M>' is not assignable to
//   parameter of type 'CanReadRecords<N, L>'.
//   → the proof is about team A; you're listing team B.

yield* contacts.list(teamA, query, readA)
// error TS2345: Argument of type 'string & Brand<"TeamId">' is not assignable to
//   parameter of type 'Named<M, string & Brand<"TeamId">>'.
//   → a raw id. Name it, then prove something about it.

yield* contacts.list(a, query)
// error TS2554: Expected 3 arguments, but got 2.
//   → no proof at all.

yield* contacts.update(target, patch, readA)
// error TS2345: Argument of type 'CanReadRecords<N, M>' is not assignable to
//   parameter of type 'CanWriteRecords<N, M>'.
//   Types of property 'kind' are incompatible.
//   → reading isn't writing.

yield* contacts.list(a, query, writeA)
// error TS2345: Argument of type 'CanWriteRecords<N, M>' is not assignable to
//   parameter of type 'CanReadRecords<N, M>'.
//   Types of property 'kind' are incompatible.
//   → and writing isn't reading. Permissions are explicit.

const escaped = named(teamA, (team) => Effect.succeed(team))
// error TS2375: Type 'Effect<Named<N, …TeamId>>' is not assignable to type 'Effect<Named<unknown, …TeamId>>'.
//   → names (and proofs) can't leave the request that created them.
```

TypeScript prints names by their declared letter (`N`, `M`, `L`), not by which variable they came from. So read *"`<N, M>` is not assignable to `<N, L>`"* as *"the proof is about a different value than the one you're passing."*

## The trap in our own auth library

Here's a hole that no type trick can close by itself, so it needs a decision.

Better-Auth's organization plugin ships its **own HTTP endpoints**: invite to a team, remove a member, update a member's role, update and delete the team (its "organization"). It enforces its own role checks, using its own access-control configuration.

If the web app calls those endpoints directly:

1. **We'd have two authorization systems.** Better-Auth's role config and our `proofs/` would have to agree forever, and the first time they drift, there's a hole.
2. **Agents lose parity.** Changing a member's role would be a web-only feature that exists outside our operations, so MCP can't do it. "Agent-first" quietly becomes "agent-mostly".
3. **Our errors disappear.** Errors would come back as Better-Auth's error strings, not our `DomainError`s with our `userMessage`s.

**Decided (D17):** member and team changes are **Parley operations** like any other. `members.changeRole` proves `CanManageMembers<P, T>` (plus the domain rules, like "a team always has at least one owner"), then calls Better-Auth's **server-side** API (`auth.api.*`) from inside a `Members` service whose methods demand that proof. Better-Auth's client-facing organization *mutation* endpoints are disabled (for example via Better-Auth's `disabledPaths` option; to be verified during implementation). Better-Auth keeps doing what it's best at, sessions, sign-in and storing members. It stops making authorization decisions.

## Stale proofs and races

A proof says a fact held **when it was checked**. It doesn't say the fact still holds a millisecond later.

For most of Parley this is fine, because proofs live for one request. `named` guarantees that structurally. The risk only appears if someone keeps a proof longer: puts it in a `Ref`, a cache, or a module-level variable, or captures it while building a `Layer`. That's the captive-dependency problem from [03 — Built once, built per team](./03-tiers.md), and the lint rules below ban it.

There's one place where milliseconds matter: **operations that change authorization state itself.** Picture two admins demoting each other at the same moment, or the last owner being removed while they transfer ownership. **Decided (D36):** for that small set (role changes, member removal, team deletion), the operation re-reads the member row `FOR UPDATE` inside the same transaction as the write, and enforces invariants like "at least one owner" there too. Ordinary record edits don't need this.

## Keeping everyone honest

TypeScript isn't Haskell. `{} as CanWriteRecords<P, T>` compiles. The honest path *never needs* `as`, so we ban the dishonest one with lint.

**GritQL rules (Biome), proposed:**

| Rule | Bans |
| --- | --- |
| `proofs-only-in-proofs` | `defineProof(...)` anywhere outside `core/src/proofs/` |
| `no-exported-prover` | exporting the value returned by `defineProof` |
| `no-proof-assertion` | `as` / `satisfies` / angle-bracket casts to any `Proof`, `Named`, or proof interface |
| `no-any-in-core` | `any` in `@parley/core` (outside `proofs/proof.ts`) |
| `no-proof-storage` | proofs or `Named` values inside `Ref`, `Layer` constructors or module scope |
| `no-db-outside-services` | importing `@parley/db` from anywhere but `core/src/services/` (package `exports` also enforce this) |

**`mistakes.ts`.** This is a file that's type-checked but never run. Every near-miss anyone almost made becomes one line under `// @ts-expect-error`: the five errors above, plus every new one we find. If a refactor ever makes one of those lines *compile*, the `@ts-expect-error` itself becomes an error and CI fails. It's the cheapest authorization regression test there is.

**Prover tests.** A prover is the only authorization code that can be wrong at *runtime*: it can query the wrong column or compare the wrong role. So each prover gets real tests against Postgres, as a small matrix: each role × each principal kind × with/without scopes × same team/other team/nonexistent team. Derivation proofs are pure, so they're cheap to test exhaustively.

**Entrypoints derive from operations.** Parley uses an operation registry (decision D16): each operation is defined once (name, description, input, output, error union) and every entrypoint derives its endpoint or tool from it. Taken together with this post, that means an entrypoint *has nowhere to put* authorization code. It receives a `Principal` and calls `operation(principal, input)`. That's it.

## Where to stop

You could name every value and prove every fact. Don't. For Parley:

- **Name ids that come from outside and touch tenant data:** `teamId`, `contactId`, `companyId`, `memberId`, `apiKeyId`. Don't name page sizes, search strings or sort orders.
- **One proof per permission, not per operation.** `CanWriteRecords` covers creating and editing contacts and companies, and affiliating them. Split a proof only when a function needs to know *which* rule granted access, or when the business rules diverge, for example "only admins may delete companies".
- **Rows you return don't need names.** `list` returns plain `Contact`s. Names are for values you're about to *act on*.
- **If a signature needs four type parameters, back off.** `affiliate` is the ceiling.
- **Let the database enforce what it can, and keep the proof anyway.** Composite foreign keys keep cross-team links out of the data. Proofs keep cross-team code paths out of the codebase.

## Open questions

Resolved: D16–D19, D27 (permissions are explicit), D28 (row-level security later; proofs plus `(team_id, id)` foreign keys for v1), D35 (no existence oracle for teams), D36 (transactional re-check for authorization changes) and D37 (other teams' records are always "not found") in the [decisions log](./decisions.md). Still open:

1. **Restoring a live record.** Should restoring a contact that isn't deleted succeed quietly (idempotent, which agents prefer, and consistent with affiliating in D43), or fail with `ContactNotDeleted`?
