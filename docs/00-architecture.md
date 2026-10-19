# One core, many entrypoints: how Parley is put together

_The architecture overview. Read this first; every other post in `docs/` builds on the names defined here._

---

Picture two users of Parley on the same morning.

Jane opens the web app, finds "Acme Pty Ltd", and fixes a typo in a contact's email address.

Jane's agent, running somewhere in a terminal, gets told "the Acme contact's email bounced, fix it" and calls the `contacts_update` MCP tool.

Those two requests should be **the same request**. Same validation. Same permission check. Same activity entry. Same error, with the same words, if Jane has since been removed from the team. If the web app can do something the agent can't, or the agent can skip a check the web app makes, we've built two products and we'll be maintaining both forever.

That is the whole design brief for Parley's architecture: **one core that knows everything, and entrypoints that know nothing.**

## The shape

```
            ┌─────────────── entrypoints ───────────────┐
            │  web UI      HTTP API      MCP     (CLI)  │   authenticate, decode, call, encode
            └─────┬────────────┬───────────┬────────────┘
                  │            │           │
                  ▼            ▼           ▼
            ┌───────────────────────────────────────────┐
            │  operations   contacts.update, …          │   one per action a principal can take
            ├───────────────────────────────────────────┤
            │  proofs       MemberOf, CanWrite…    │   the ONLY place authorization is decided
            ├───────────────────────────────────────────┤
            │  services     Contacts, Companies         │   demand proofs, do the IO
            ├───────────────────────────────────────────┤
            │  db           Drizzle schema, SqlClient   │   only services can reach it
            └───────────────────────────────────────────┘
```

Each layer has one job and one direction of knowledge. Entrypoints know about operations. Operations know about proofs and services. Services know about the database. Nothing points upward.

## The packages

Parley is a **monorepo of Bun workspace packages**. Package boundaries, enforced with each package's `exports` field and Biome import rules, turn "please don't import that from there" into "that import doesn't resolve".

| Package          | What lives there                                                                                                                                     | May depend on                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@parley/errors` | `UserText`, `DisplayName`, `PublicError`, `DomainError`, `toPublicError`                                                                             | `effect` only                 |
| `@parley/domain` | Branded ids (`TeamId`, `ContactId`, …), record schemas, every error class, the error union for every operation. No IO; safe to ship to the browser. | `errors`                      |
| `@parley/db`     | Drizzle schema, migrations, the `SqlClient` layer                                                                                                    | `domain`                      |
| `@parley/core`   | `operations/`, `proofs/`, `services/`, principal resolution                                                                                          | `domain`, `errors`, `db`      |
| `@parley/api`    | The `HttpApi` contract: endpoints, payloads, and the tag→status map                                                                                  | `domain`, `errors`            |
| `@parley/http`   | `HttpApi` handlers: thin, call operations                                                                                                            | `api`, `core`                 |
| `@parley/mcp`    | MCP tools: thin, call operations                                                                                                                     | `core`, `domain`              |
| `apps/web`       | TanStack Start: routes, UI, Tailwind, TanStack DB/Query. Mounts `/api/v1`, `/mcp`, `/api/auth`                                                       | `api` (client), `http`, `mcp` |

Two rules make this layout pay off:

1. **Only `@parley/core` imports `@parley/db`.** An entrypoint cannot run a query, because it cannot even import the table.
2. **Only `core/src/proofs/` can mint a proof.** An entrypoint cannot "just skip the check", because the service it wants to call will not compile without a proof (see [04 — Proof, not promises](./04-authorization-proofs.md)).

## The tech stack

| Concern                               | Choice                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Runtime + package manager             | Bun                                                                     |
| App framework                         | TanStack Start                                                          |
| Backend effects, DI, errors, HTTP API | Effect v4 (`Context.Service`, `Layer`, `Schema.TaggedError`, `HttpApi`) |
| Database                              | Postgres via Drizzle                                                    |
| Auth                                  | Better-Auth with the organizations plugin                               |
| Client data                           | TanStack DB + TanStack Query                                            |
| Styling                               | Tailwind                                                                |
| Lint and enforcement                  | Biome + GritQL rules, `@effect/language-service` diagnostics            |

## The vocabulary

These words mean exactly one thing everywhere in the codebase and in these docs.

**Principal**: _who is knocking._ The output of authentication, before we know anything about teams. It's a union of three kinds: a user in the web app, an agent using a user's API key, and an agent using a service account's API key:

```ts
type Principal =
  | UserSession           // Jane, signed in to the web app (Better-Auth session cookie)
  | UserApiKey            // Jane's agent, using an API key Jane created (Jane's identity, bound to one team, limited by scopes)
  | ServiceAccountApiKey; // an agent using the API key of "Support Bot", a service account that is a member in its own right
```

**Team**: the tenant (stored as a Better-Auth organization). A user can be a member of many teams and switches between them; every request names exactly one.

**User**: a human who can sign in. **Service account**: a non-human identity that is a member of one team. **Agent**: external AI software (Claude, ChatGPT, opencode, …) that calls Parley with an API key. An agent is never a principal by itself; its API key decides who it acts as.

**Member**: a user or service account that belongs to a team, with exactly one role. The role named `member` is simply the default role a member gets.

**Role**: `owner | admin | member`, one per member. The `member` role is the default role; write "the `member` role" when it could be confused with "a member".

**Permission**: a capability the core checks. v1 has a small, fixed set:

| Permission | member | admin | owner |
| --- | :-: | :-: | :-: |
| `records:read`: see contacts and companies | ✓ | ✓ | ✓ |
| `records:write`: create and edit them | ✓ | ✓ | ✓ |
| `records:delete`: delete and restore them | ✓ | ✓ | ✓ |
| `fields:manage`: create, edit and delete custom fields | | ✓ | ✓ |
| `members:manage`: invite, remove, change roles | | ✓ | ✓ |
| `service-accounts:manage`: service accounts and their API keys | | ✓ | ✓ |
| `team:manage`: rename, billing, delete the team | | | ✓ |

Every user manages their own API keys; that needs no permission beyond being a member.

**Permissions are explicit.** None implies another: `records:write` does not include `records:read`. Every role grants all three record permissions, so this only matters for API key scopes. An API key gets exactly the permissions written on it.

**Scopes**: an API key's own ceiling. An API key Jane creates with only `records:read` can never write, even though Jane can. _Effective permissions = role permissions ∩ scopes._ That intersection is computed in exactly one function.

**Operation**: one action a principal can take, such as `contacts.update`. It has a name, a description, an input schema, an output schema, an error union, and a body. It is defined once in the **operation registry**, and every entrypoint is derived from it (decision D16). **Every entrypoint exposes the same operations.**

**Proof**: a compile-time value showing that a fact was checked about _these exact values_. For example, `CanWriteRecords<P, T>` means "principal P may write records in team T". A proof can carry what the check found: `MemberOf<P, T>` carries the role and effective permissions. See [04](./04-authorization-proofs.md).

## The records (v1)

Every tenant table carries `team_id`, and every foreign key between tenant tables includes it, as `(team_id, id)`. So a row can only ever point at a row in the same team.

- **Contact.** An optional first name and last name. The display name is derived from them and falls back to the primary email. A contact has any number of email addresses, exactly one of which is the **primary email**, and each address belongs to at most one contact in a team. It also has any number of phone numbers, each with a label (work, mobile, …), stored in E.164 format; phone numbers don't have to be unique.
- **Company.** A name and any number of domains (`acme.com`, `acme.co.uk`). Each domain belongs to at most one company in a team.
- **Affiliation.** The link between a contact and a company, with an optional title ("CTO"). It is many-to-many: a contact can be affiliated with several companies, and a company has many contacts.
- **Custom field.** A field a team defines on contacts or on companies. The types are text, number, date, checkbox, single select, multi select, URL, email and phone. There is deliberately no type that references another record. Creating, editing or deleting a custom field needs `fields:manage`.
- **Delete.** Deleting a record hides it immediately and frees its email addresses and domains for reuse. It can be **restored** for 30 days, after which it is **purged**, meaning permanently removed.

Postgres row-level security is deferred (D28). Proofs plus `(team_id, id)` foreign keys are the v1 design, and the `team_id` column on every tenant table keeps RLS a cheap addition later.

## One request, all the way down

Here is Jane's agent fixing that email, layer by layer.

**1. The entrypoint authenticates, and only authenticates.** The MCP server reads the API key from the request and asks Better-Auth who it belongs to. It gets a `UserApiKey` principal back, or fails with `ApiKeyRevoked`, `ApiKeyExpired`, or `ApiKeyUnrecognized`. It does **not** check permissions; it doesn't know how.

**2. The entrypoint decodes input with the operation's schema** and calls the operation:

```ts
// packages/mcp: the entire tool handler
const result = yield* operations.contacts.update(principal, input);
```

That's the whole entrypoint. The HTTP handler and the web app's API call are the same line.

**3. The operation proves, then acts.** This is the one place the check-then-act sequence is written:

```ts
// packages/core/src/operations/contacts.update.ts
export const update = Effect.fn("contacts.update")(function* (
  principal: Principal,
  input: UpdateContactInput,
) {
  const contacts = yield* Contacts;
  return yield* named(
    principal,
    input.teamId,
    input.contactId,
    (principal, team, contact) =>
      Effect.gen(function* () {
        const member = yield* proveMemberOf(principal, team); // fails: NotATeamMember | ApiKeyNotValidForTeam (also when the team doesn't exist: D35)
        const canRead = yield* proveCanReadRecords(member); // fails: RoleLacksPermission | ApiKeyScopeExcludes
        const canWrite = yield* proveCanWriteRecords(member); // fails: RoleLacksPermission | ApiKeyScopeExcludes
        const target = yield* proveContactInTeam(team, contact, canRead); // fails: ContactNotFound (also when it's in ANOTHER team, or deleted)
        return yield* contacts.update(target, input.patch, canWrite); // fails: ContactEmailTaken, InputRejected, …
      }),
  );
});
```

**4. The service demands proof.** `contacts.update` will not accept a raw `ContactId`. It wants a contact proven to belong to team `T` (which needed read access to find), plus a write proof about the same `T`. Hand it a proof about a different team and it's a compile error, not a data breach.

**5. Errors come back as data.** Every error above is its own class with a `userMessage` written in our words. The entrypoint maps each one to its format, so you get a 403 over HTTP and an `isError` tool result over MCP. A new error class doesn't compile until **every** entrypoint has decided what to do with it. See [01 — Errors are data](./01-errors-are-data.md).

## Why this is worth the ceremony

- **One test surface.** Operations are where behavior lives. Test them once with real layers, and every entrypoint inherits the confidence. Entrypoint tests only check translation.
- **Agent parity is structural, not aspirational.** If an operation exists, every entrypoint can expose it. "The API doesn't support that yet" stops being a sentence we say.
- **Auth lives in one directory.** `core/src/proofs/` is small, reviewed carefully, and the only place authorization decisions are made. No `if (user.role === "admin")` sprinkled through route handlers, because route handlers can't make the service call without a proof anyway.
- **Tenant leaks are type errors.** Tiers ([03](./03-tiers.md)) stop process-wide things from capturing per-team things. Proofs ([04](./04-authorization-proofs.md)) stop a contact from team A being written with team B's permission.

## The posts

| #   | Post                                                                | One-line summary                                                                          |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 00  | **One core, many entrypoints** (this one)                           | Packages, vocabulary, and the request lifecycle                                           |
| 01  | [Errors are data](./01-errors-are-data.md)                          | One class per error, `PublicError` is the only way out, every entrypoint maps every tag |
| 02  | [The friend who picks up the phone](./02-writing-error-messages.md) | How we write `userMessage`: what happened, what's safe, who can fix it, a way out         |
| 03  | [Built once, built per team](./03-tiers.md)                         | Making cross-team leaks a compile error                                                   |
| 04  | [Proof, not promises](./04-authorization-proofs.md)                 | Authorization as proofs the compiler demands                                            |
| 05  | [The product you feel](./05-ux-principles.md)                       | What Linear's redesign teaches us about building Parley's UI                              |

[Terminology](./terminology.md) defines every term; synonyms are banned. [Decisions log](./decisions.md) records what we decided, who decided it, and what's still open.
