# Proof, not promises: authorization the compiler can check

*How proof-bearing service contracts require checked values, and where runtime checks and review remain necessary.*

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

We are **not** using the `gdp-ts` library. Parley uses an Effect-native implementation in `core/src/proofs/proof.ts`. The ideas, the variance tricks and most of the vocabulary come straight from `gdp-ts`. What changes is that our provers return an `Effect` that **fails with a specific, typed error** instead of returning `null`. That fits [Errors are data](./01-errors-are-data.md): "you can't do that" is never one generic 403. It is `RoleLacksPermission { needed: "records:write" }`, or `ApiKeyScopeExcludes { needed: "records:write" }`, and those have different fixes and different messages.

## The rule, in one sentence

> **Entrypoints authenticate. Proofs authorize. Services demand proofs.**

- An **entrypoint** (web, HTTP, MCP, CLI) turns a session cookie or an API key into a `Principal`, which says *who is knocking*. That's all it does. It contains no `if (role === …)` and no permission names. It couldn't use them anyway.
- **`core/src/proofs/`** is the *only* directory that decides authorization. Each file checks one fact and mints a proof of it.
- **Services** (the code that touches the database) take proofs as arguments. Provers decide authorization; services enforce database invariants such as keeping a last owner inside the same transaction as the write.

The type checker enforces the required kinds and names; runtime checks enforce when named values and proof fields may be read.

## Three ideas, in order

### 1. Name the values

A `ContactId` is a branded string. That stops you passing an `TeamId` where a `ContactId` belongs. But it can't tell *this* contact from *that* contact: two `ContactId`s have the same type.

So we give values a **name**, a type that exists only at compile time and is different for every value we name:

```ts
named(principal, input.teamId, input.contactId, (principal, team, contact) =>
  Effect.sync(() => ({
    userId: principal.value.userId,
    teamId: team.value,
    contactId: contact.value,
  })),
)
```

`named` returns an `Effect`. Each execution creates fresh, frozen named values and invokes the callback, which must return an `Effect`. The generic callback keeps the names distinct in the type checker. A private field makes `Named` opaque: spreading it into `{ ...team, value: anotherTeamId }` loses the private identity and cannot satisfy a service signature.

At runtime `.value` is a getter over the original value. It refuses reads after the callback's Effect finishes, including failure, defects and interruption. Re-running the same Effect creates a new execution; it never reactivates old named values. Nested executions expire independently.

### 2. Prove facts about names

A proof is a value of type `Proof<Kind, About>`. For example, `CanWriteRecords<P, T>` means *"principal `P` may write records in team `T`"*. It's minted by a **prover**, and each prover lives in exactly one file in `proofs/`. That file doesn't export the prover, so it's the only place in the codebase that can create that kind of proof.

```ts
// core/src/proofs/can-write-records.ts
const CanWriteRecords = defineProof("CanWriteRecords")           // NOT exported
export interface CanWriteRecords<P, T> extends Proof<"CanWriteRecords", [P, T]> {
  readonly member: MemberOf<P, T>
}

export const proveCanWriteRecords = <P, T>(member: MemberOf<P, T>) =>
  requirePermission(member, "records:write").pipe(               // fails: RoleLacksPermission | ApiKeyScopeExcludes
    Effect.map(() => CanWriteRecords.prove([member.principal, member.team], { member })),
  )
```

A proof records its kind, the named values it is about, and any fields the check discovered. Provers supply those fields to `.prove([namedValues], fields)`; they never assemble proofs with object spread. Proofs have a private identity and frozen properties, so a copied membership proof with different permissions is rejected by TypeScript. Reading a proof's kind or carried fields also checks that its named values are still usable.

### 3. Demand proofs

Sensitive functions take proofs about their exact arguments:

```ts
readonly update: <P, T, C>(
  target: ContactInTeam<C, T>,         // this contact, proven to live in team T
  patch: ContactPatch,
  access: CanWriteRecords<P, T>,      // write permission, proven for THE SAME team T
) => Effect.Effect<Contact, ContactEmailTaken>
```

The shared `T` requires the contact proof and permission proof to name **the same team**, or TypeScript rejects the call. That closes the mismatched-argument mistake from the opening example. SQL inside the prover and service remains trusted code.

## The module

The implementation lives in [`packages/core/src/proofs/proof.ts`](../packages/core/src/proofs/proof.ts). The trusted constructors stay private; other files import only the `Named` and `Proof` types, `named`, and `defineProof`.

Two separate checks protect callers:

**Value identity, checked by TypeScript.** Invariance (`in out` and the phantom function fields) prevents substituting a different name. Private fields prevent object spread from preserving the identity while replacing a value or checked fact. A service takes its IDs from the named values or proofs supplied to it.

**Execution lifetime, checked at runtime.** TypeScript rejects directly returning a named value with its name erased to `unknown`, but it cannot prevent returning a closure that captures one. A closure or delayed Effect can outlive the callback without exposing a named type in its signature. `named` therefore expires access to named values and proof fields when its Effect finishes. Misuse raises a defect, which the entrypoint logs and turns into a safe public error.

This is not general memory confinement. Ordinary IDs, records, and permission snapshots read during execution remain ordinary values afterward. Services must consume named values and proof fields during the Effect that performs the work; a check cannot revoke data already read or an external request already sent. Proofs record facts checked at a point in time, not a database lock or a promise that authorization will stay unchanged.

The constructors freeze their own properties, not the entire object graph. Fields such as permission sets are exposed through readonly types; arbitrary assertions, reflection, and mutation through an independently held alias remain outside the type guarantee. The proof module is trusted code, not a sandbox for hostile JavaScript.

## Selected implemented proofs

This table introduces a subset of the implemented proof catalog. Additional proofs live in `core/src/proofs/`; the table is not an exhaustive list. Letters: `P` for a principal, `T` for a team, `C` for a contact, `K` for a company.

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
| `ContactRestorable<C, T>` / `CompanyRestorable<K, T>` | the record belongs to T and is live or deleted inside the restore window | **Database**, and requires read access to T | `ContactNotFound` / `CompanyNotFound` |
| `CustomFieldInTeam<F, T>` | custom field F exists and belongs to T | **Database**, and requires read access to T | `CustomFieldNotFound` |

The `…InTeam` proofs only ever find records that haven't been deleted. Ordinary contact reads use `ContactInTeam` and refuse deleted records. Restore uses `ContactRestorable`, which also accepts a live record so repeated restores are idempotent. Once a record is purged, restore returns `ContactNotFound`. Deleted-list queries are a separate explicit path.

Two design choices are buried in that table.

**Proofs make proofs.** Only `MemberOf` and the `…InTeam` proofs touch the database. Every `Can…` proof is derived from a `MemberOf` by a *pure* function, with no query. An operation pays for one member lookup, then derives whatever permissions it needs for free. (`gdp-ts` describes this pattern as a proof that carries what the check discovered; `MemberOf` carries the role and permission set the derivations read.)

**No existence oracle.** If you aren't a member of a team, we don't tell you whether it exists: `NotATeamMember` covers both cases (D35). If a contact is in *another* team, you get `ContactNotFound`, exactly as if it didn't exist, even if you're a member of that other team too (D37). Someone probing ids learns nothing. The check is also ordered: you need read access to team `T` *before* we'll even look up whether contact `C` is in it.

### One function computes effective permissions

The [architecture overview](./00-architecture.md) defines effective permissions as role permissions restricted by scopes. [`requirePermission`](../packages/core/src/proofs/permissions.ts) owns the decision: it checks the acting member's role, the connecting person's role for a service-account connection, and then the API-key or connection scope ceiling. `proveMemberOf` supplies the checked member data; permission derivation does not query again.

Role and scope are separate errors because a user needs to know *which* one to fix. One sends you to an admin; the other sends you to your API key settings. That's the [error messages post](./02-writing-error-messages.md) in action.

**Permissions are explicit (D27).** No permission implies another. `records:write` doesn't include `records:read`, and `records:delete` includes neither. An operation proves every permission it uses: `contacts.update` proves read access (to find the contact) *and* write access (to change it). Every role grants all three record permissions, so this only matters for API key scopes. An API key gets exactly the permissions written on it, nothing hidden in an implication table, and the scope list on the API key settings screen is the whole truth.

## Sessions, API keys, and connections, one prover

The implemented [principal union](../packages/core/src/principal.ts) supports sessions, API keys, and OAuth connections:

```ts
type Principal = UserSession | UserApiKey | ServiceAccountApiKey | UserConnection | ServiceAccountConnection
```

`proveMemberOf` centralizes the membership check for these principal kinds. Authentication and activity attribution also distinguish kinds; authorization is not duplicated across entrypoints.

The implementation is [`proveMemberOf`](../packages/core/src/proofs/member-of.ts). It checks the principal's team restriction, loads their current role, and, for a service-account connection, also checks the user who connected the agent. It then passes those checked fields to `MemberOfProver.prove([principal, team], fields)`. The returned proof carries the named principal and team, the role permissions, and the API key or connection scope ceiling.

Registered operations share the same authorization implementation across HTTP and MCP. The web client calls HTTP. Separate authentication, file, public-form, and webhook routes have their own access rules; the operation registry does not prove that arbitrary entrypoint code cannot make an authorization decision.

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

- **`list`** takes a named team and a read proof about that same team. The service must use that team to restrict results and counts, including filtered and paged queries. The signature does not enforce the SQL predicate. Queries for child data may use parent IDs already located in the proven team.
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

The implementation's expected error union is inferred from its steps and checked against the registered contract. The shared HTTP status map covers its tags; MCP uses shared public conversion (see [01](./01-errors-are-data.md)).

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
//   → a named value cannot escape directly with its type-level name.

yield* contacts.list({ ...a, value: teamB }, query, readA)
// error: the copy has no private Named identity.

yield* proveCanWriteRecords({ ...memberOfA, rolePermissions: new Set(["records:write"]) })
// error: the copy has no private Proof identity.

const retained = named(teamA, (team) => Effect.succeed(() => team.value))
// This compiles: a closure hides the named type. Reading through it after
// retained completes raises a defect at runtime.
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

## SQL isolation is a service responsibility

**Decided (D28, D166): service SQL is trusted, and RLS remains deferred.** The types prevent missing proofs and mixing independently named values. They do not prove that a query's predicates, joins, aggregates, or selected columns are correct.

| Mechanism | What it enforces | What it leaves to trusted code |
| --- | --- | --- |
| Named values and proof signatures | Required proof kinds and matching names in each signature | SQL inside provers and services |
| Runtime expiration | Named-value and proof-field reads stop after their Effect execution | Correct query construction while the execution is active |
| Composite team foreign keys | Inserts and updates cannot create a cross-team link covered by that constraint | Reads, unrelated writes, and links without a composite team constraint |
| Service review and Postgres tests | Evidence for the SQL paths and scenarios reviewed or exercised | Unreviewed changes and cases the tests do not exercise |

The schema's composite team foreign keys cover contact emails and phones, company domains, and both sides of affiliations. Other relationships, including segment contacts and topic links, use single-ID foreign keys; their service checks are responsible for team consistency. Import parts are owned through their import rather than carrying a team column. Do not assume a team column or a foreign key establishes more than its actual definition does.

Every team-scoped query needs an explainable restriction: the proven team, or a parent ID already located in that team. Check that restriction for lists and counts, every paging branch, joins, filter subqueries, exports, bulk selections, restore markers and import matching. A principal's access to two teams never permits a request naming one team to return or modify the other's records. Background work that intentionally scans several teams has a separate, explicit responsibility to carry the correct team into each piece of work; there is no ambient current-team variable.

### Regression coverage

[`team-isolation.test.ts`](../packages/core/test/team-isolation.test.ts) adds the cases missing from the earlier single-team and membership-denial tests. Its principal belongs to both teams. Both contain the same email addresses, company domains and matching search values, with distinguishable output values. Each scenario checks a positive own-team result as well as exclusion of the other team.

| Path | Behavior exercised |
| --- | --- |
| Lists | Results and totals, OR filters, cursor pages and sorted offset pages |
| Joins and matching | Domain matching, contact affiliations, company contact counts, and foreign-company filters |
| Resource IDs | Foreign contact/company IDs refuse reads, edits and deletes; foreign records stay unchanged |
| Exports | Full, filtered, picked-ID and dynamic-segment CSV exports exclude foreign records |
| Segments | Dynamic segment contacts and sendable counts stay within the team |
| Bulk changes | Matching and mixed-ID updates/deletes cannot touch the other team; foreign deletion markers cannot restore its records |
| Imports | Equal emails, domains and company names in two teams update only the requested team's records |
| Declared constraints | Direct cross-team affiliation inserts fail on both composite foreign keys in Postgres |

Existing tests in `contacts.test.ts`, `companies.test.ts`, `notes.test.ts`, `selections.test.ts`, `segments.test.ts`, and `imports.test.ts` also exercise membership denials, foreign IDs, scope limits and selection boundaries. This is a focused regression inventory, not exhaustive coverage of every operation, relationship, worker or future query. Extend the owning tests when changing SQL that crosses one of these paths; assert returned values and that foreign data remains unchanged. A denied request alone does not exercise successful-query filtering.

### What adopting RLS would require

If revisited, keep role and scope decisions in core and evaluate team-only database policies as an additional safeguard. Runtime credentials must actually be subject to those policies; transaction-local team state must be set on the same connection as the work and must not survive pooled reuse. Missing context should refuse access. Parent-owned children, migrations, public form paths and workers that scan several teams need deliberate treatment. Policy coverage must be checked when tables change, and actual query plans and round-trip costs need measurement.

The [PlanetScale discussion](https://planetscale.com/blog/rls-sounds-great-until-it-isnt) motivates evaluating those costs rather than adopting RLS by default. [PostgreSQL's row-security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) describes the policy and privilege behavior. Existing team IDs help identify ownership; neither universal policy coverage nor a migration-free retrofit follows from their presence. No custom query abstraction is introduced to imply enforcement that an unrestricted SQL callback cannot supply.

## Stale proofs and races

A proof says a fact held **when it was checked**. It doesn't say the fact still holds a millisecond later.

A short execution reduces this window; it does not eliminate it. `named` checks access to named values and proof fields at runtime after the Effect finishes. TypeScript alone cannot prevent retaining them in closures. Storage rules described below are proposed additional checks, not the mechanism that enforces expiration. Background work stores ordinary IDs and rechecks authorization in a new execution; it never treats a retained proof as fresh authorization.

**Operations that change authorization state itself must check and write atomically.** Two admins must not both act on permissions one has just removed from the other. An admin must not change a target who became an owner while the request waited. Two owners must not both give up ownership.

**Implemented (D36, D165):** [`MemberChanges.inTeam`](../packages/core/src/services/member-changes.ts) starts a `READ COMMITTED` database transaction and locks the team's row `FOR UPDATE`. After acquiring the lock, it creates a fresh named team and supplies an opaque `MemberTransaction<T>` to the callback. The operation then proves the principal's current role, permission ceiling, and target's current role and performs the write. The write methods require both this member transaction and proofs about its fresh team name. A proof made before acquiring the lock cannot satisfy that signature, even when the raw team ID is the same.

```ts
return yield* changes.inTeam(input.teamId, (transaction) =>
  Effect.gen(function* () {
    const member = yield* proveMemberOf(principal, transaction.team)
    const access = yield* proveCanManageMembers(member)
    const target = yield* proveMemberChangeable(access, user, input.role)
    return yield* members.changeRole(transaction, target)
  }),
)
```

The stable team row is the common lock for role changes, removals, and service-account creation, changes and deletion. Invitation creation, refresh, revocation, acceptance and decline use it too; recipient operations re-read the invitation after locking. Creating a new team establishes its first owner through Better-Auth before that team is available to other requests. Team deletion is not implemented and must use the same lock if introduced.

`READ COMMITTED` is set explicitly before the lock query. Subsequent proof queries therefore see commits made while that query waited, even if the server's default isolation level differs. `inTeam` owns the outer transaction; call it before other transactional work. Its callback runs on that transaction's connection. Services cannot replace the connection or move a protected write to a detached fiber. As with other named values, retaining the transaction does not retain usable access after its callback finishes.

`MemberChangeable<P, T, U>` carries the exact `newRole` checked by the prover. `Members.changeRole` takes that role from the proof rather than accepting another role argument. Removal requires a distinct `MemberRemovable<P, T, U>` proof, which includes the signed-in-user restriction when leaving. Both facts name the principal as well as the team and target, so the operation checked is the operation performed. `MemberInvitable<P, T>` carries the permitted invitation role; an ordinary member-management proof cannot be used to invite an owner.

The team lock stays held through the last-owner check, all database writes, and the returned result. A typed error or defect rolls back the work. There is no owner-only lock set whose membership can change between requests. Teams proceed independently. Ordinary record edits keep their existing behavior; this mechanism serializes member and invitation changes, not every operation in a team.

Permission proofs derive from the membership lookup in memory. The target's role, read under the team lock, determines whether an owner count is needed: only demoting or removing an owner queries that invariant. Role updates join the user's details and return the result with `UPDATE … FROM … RETURNING`, avoiding a separate result query. These reductions keep every authorization read inside the transaction.

Invitation email is prepared during the transaction and sent after commit. Provider latency does not hold the team lock. If delivery fails, the invitation remains pending and inviting the address again refreshes it and retries delivery. This is not atomic email delivery; a durable email outbox would be a separate guarantee.

The SQL predicates and the use of the transaction connection remain trusted service code. The fresh name proves where authorization was built; it does not make arbitrary SQL correct. Concurrency regressions use real Postgres locks to commit a role change or removal while another request waits, and verify that the waiting request is refused with the appropriate typed error.

## Keeping everyone honest

TypeScript assertions and trusted constructor misuse can bypass proof types. Current lint matches some common syntax; it is not a general proof sandbox.

| Check | Current status and scope |
| --- | --- |
| `proofs-only-in-proofs` | Implemented: matches direct `defineProof(...)` calls outside `core/src/proofs/`. |
| `no-proof-assertion` | Implemented: matches `as` assertions to the proof types explicitly listed in the rule, outside `proofs/proof.ts`. It does not cover all proof types or cast syntax. |
| Explicit `any` | Biome rejects it under its configured rule, with existing diagnostic suppressions. There is no separate `no-any-in-core` plugin. |
| `no-db-outside-services` | Implemented for matching `@parley/db` imports, with auth, core composition, database-package, and test exceptions. Package exports do not restrict which workspace may consume the package. |
| Exported prover factories | No dedicated lint rule; review must keep minting capabilities private. |
| Proof storage in `Ref`, `Layer`, or module state | No dedicated lint rule. Runtime lifetime checks reject later named-value and proof-field access; they do not prevent storage. |

The exact source and configuration are linked in the [lint inventory](./10-implementation-status.md#configured-lint-inventory). Additional rules remain planned rather than silently enabled.

**`mistakes.ts`.** This is a file that's type-checked but never run. Every near-miss anyone almost made becomes one line under `// @ts-expect-error`: the five errors above, plus every new one we find. If a refactor ever makes one of those lines *compile*, the `@ts-expect-error` itself becomes an error and CI fails. It's the cheapest authorization regression test there is.

**Prover and service tests.** Provers can query the wrong column or compare the wrong role; services can also build incorrectly scoped SQL after accepting valid proofs. Test authorization decisions across roles, principal kinds, scopes and team boundaries, and test successful service queries with records in multiple teams. Derivation proofs use in-memory permission data; their tests do not need another database query.

**Publication follows the registry and exposure manifest.** Registered HTTP endpoints and MCP tools use the shared operation contracts and implementations (D16/D171). Their entrypoints authenticate, decode, and call the operation. Inclusion does not grant permission; it makes the capability reachable through that entrypoint. This convention does not forbid all alternate response or authorization code.

## Where to stop

You could name every value and prove every fact. Don't. For Parley:

- **Name ids that come from outside and touch tenant data:** `teamId`, `contactId`, `companyId`, `memberId`, `apiKeyId`. Don't name page sizes, search strings or sort orders.
- **One proof per permission, not per operation.** `CanWriteRecords` covers creating and editing contacts and companies, and affiliating them. Split a proof only when a function needs to know *which* rule granted access, or when the business rules diverge, for example "only admins may delete companies".
- **Rows you return don't need names.** `list` returns plain `Contact`s. Names are for values you're about to *act on*.
- **If a signature needs four type parameters, back off.** `affiliate` is the ceiling.
- **Let the database enforce what it can, and keep the proof anyway.** Composite foreign keys prevent cross-team links only where declared. Proofs constrain callers' arguments. Services still own SQL scoping; neither mechanism proves arbitrary queries safe.

## Open questions

Resolved: D16–D19, D27 (permissions are explicit), D28 and D166 (RLS deferred; service SQL explicitly trusted, with declared constraints and cross-team regressions), D35 (no existence oracle for teams), D36 (transactional re-check for authorization changes) and D37 (other teams' records are always "not found") in the [decisions log](./decisions.md). Current restore behavior:

The public restore prover accepts a live record or a deleted record inside the restore window. The service returns the current record when it is already live, so restore is idempotent. Missing, foreign, or purged records produce the corresponding not-found error. There is no implemented `ContactNotDeleted` class.
