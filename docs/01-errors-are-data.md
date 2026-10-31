# Errors are data

*How Parley declares, carries, and delivers every expected error. It builds on the vocabulary in [00 — One core, many entrypoints](./00-architecture.md).*

---

It's 2am and Jane's agent is cleaning up her CRM. It calls `contacts_update` and gets back this:

```
Error: duplicate key value violates unique constraint "contact_emails_team_id_address_key"
```

What should the agent do now? Retry? Wait? Give up? Ask Jane? The text doesn't say. Worse, it has just told a third party the name of one of our database constraints. And if the agent writes "I hit a database error, sorry" in its summary, Jane learns nothing either.

Now the same error, Parley-style:

```json
{
  "_tag": "ContactEmailTaken",
  "userMessage": "Another contact in Acme Sales already uses jo@example.com. Open that contact to update it, or use a different email.",
  "isRetryable": false
}
```

The agent branches on `_tag`. It sees that retrying is pointless, finds the other contact, and merges. Jane, reading the agent's summary, gets a sentence that names her team, tells her what happened, and tells her what to do.

That difference is not about copywriting. It's about architecture. This post is about how we make the second version the *only* version that can be built.

## The five goals

1. **Every error a user can see is precise.** It says what happened and why, what was kept, how to fix it and who can, and what else they can do. "Something went wrong" is reserved for genuine bugs.
2. **Text we didn't write never leaves the core.** Not exception messages, not Postgres errors, not Better-Auth internals, not Schema's default decode messages. The types and lint guarantee this, not code review.
3. **Callers decide using data, not strings.** Whether to retry, wait, show, or skip comes from typed fields on the error. Nobody ever writes `if (err.message.includes("duplicate"))`.
4. **One shape everywhere.** Core, the HTTP API, MCP, the web app, and the future CLI all speak the same public error shape, defined once.
5. **An unhandled error is a compile error, not a production 500.** Add a new error class and every entrypoint that can encounter it stops compiling until it has decided what to do.

## The rules, in one table

| Decision | Choice | Why |
| --- | --- | --- |
| Granularity | One `Schema.TaggedError` class per error. One error union per operation. No `reason`/`kind` string fields. | Each error needs its own message, its own retry rule and its own severity. A `reason` string scatters those decisions into `switch` statements everywhere. |
| Naming | Named for the condition: `ContactNotFound`, `ApiKeyRevoked`. No `Error` suffix, no layer names. | Every class in the union is an error, so the suffix adds nothing. Being specific is the point. |
| Title | None. The `_tag` *is* the title. | A second string would drift out of sync. The UI decides how to present a tag. |
| User text | A single `userMessage: UserText` that everyone sees. | It names who can fix the problem ("a team admin can…"), so it works for every reader. |
| Remedy | In `userMessage` if a user can act on it. In `message` (logs) if only an operator can. | No separate remedy field to keep in sync. |
| Retry | `isRetryable: boolean` means "the same request, sent again unchanged, might succeed". Add `retryAfter: Duration` only when we actually know how long. | Matches Effect's own convention. An error that explicitly represents unconfirmed acceptance is not retryable. The flag is not an operation-wide idempotency guarantee; callers still consider operation semantics and their time budget. |
| Severity | `[ErrorReporter.severity]` is required: `"Info"` for an expected refusal, `"Warn"` for an error outside our control. | Logs and alerts need it, and forgetting it should be impossible. Bugs are never `DomainError`s, so there is no `"Error"` level here. |
| Cause | `cause: Schema.Defect()` only on classes that wrap something we didn't originate (Postgres, Better-Auth, network). | Keeps the original for logs without pretending it has a schema. It is never public. |
| Leaving the core | `toPublicError(error)` is the only way an error leaves the core. | The class's own schema includes `message` and `cause`. Encoding the class directly would leak both. |
| Units | Time on the wire names its unit: `retryAfter` goes out as `retryAfterMillis`. | A bare number for time is ambiguous. |

## The parts

```
@parley/errors            depends only on effect
  UserText, userText      text for users and agents, built from our own words
  DisplayName             a name the reader already sees in the app
  PublicError             schema: what may leave the system
  DomainError             interface: PublicError + message + severity
  toPublicError           the only way out

@parley/domain            browser-safe, no IO
  error classes           one Schema.TaggedError per error, implements DomainError
  <Op>Error unions        Schema.Union per operation, plus is<Op>Error = Schema.is(...)

@parley/core
  classifiers             foreign error (Postgres, Better-Auth) -> one of our classes
  DisplayName.fromRecord  only in services, where names are read from rows

entrypoints
  @parley/http            exhaustive tag -> status map, sends toPublicError(e)
  @parley/mcp             isError tool result carrying toPublicError(e)
  apps/web                reads error._tag / isRetryable / retryAfterMillis
```

Error classes live in `@parley/domain` rather than `@parley/core` for one reason: **the browser needs them**. The web app matches on `ContactEmailTaken` to highlight the email field, and it can only do that if the class (or at least its tag) is importable without dragging in Drizzle.

### `UserText` and `userText`

`UserText` is a branded string. The only sanctioned way to make one is the `userText` tagged template, and the template is picky about what you can put in a `${}`:

| Value | Allowed? |
| --- | --- |
| Fixed words, including literal unions (`n === 1 ? "contact" : "contacts"`) | ✅ |
| Numbers | ✅ |
| `DisplayName` | ✅ |
| Another `UserText` (a helper's result, or a wrapped error's `userMessage`) | ✅ |
| `EchoedInput`: a value from the **current request**, length-capped (D38) | ✅ |
| `string`, `error.message`, an id, any other brand | ❌ compile error |

```ts
userText`${team.name} has ${count} ${count === 1 ? "contact" : "contacts"} with that email.` // ✅
userText`Failed: ${cause.message}`                                                         // ❌ string
userText`Contact ${contactId} not found`                                                   // ❌ ContactId is not DisplayName
```

That last one matters. An id in a user message is jargon to a user, and to an agent it's a value that belongs in a structured field.

`EchoedInput` exists so a message can say "**jo@example.com** is already used by Sam Lee" (D38). You make one only from a value in the request being answered, it's capped in length, and the dedicated brand keeps every use deliberate and greppable. It never carries a stored value someone else entered. `InputRejected` still never echoes the rejected value.

### `DisplayName`

`DisplayName` means "a name the reader already sees in the app": a team name, a company name, a contact's full name, a user's name. You make one with `DisplayName.fromRecord(row.name)` **inside a service**, where the name is read from its row, and pass it down as a typed field.

It is not a loophole. If you're tempted to write `DisplayName.fromRecord("the server")`, write those words in the template instead.

### `PublicError`, `DomainError`, `toPublicError`

```ts
// @parley/errors
export const PublicError = Schema.Struct({
  _tag: Schema.String,
  userMessage: UserText.schema,
  isRetryable: Schema.Boolean,
  retryAfterMillis: Schema.optional(Schema.Number),
  details: Schema.optional(Schema.Unknown),   // per-tag schema, declared in @parley/api (D44)
})

export interface DomainError extends Cause.YieldableError {
  readonly _tag: string
  readonly message: string                                  // logs only
  readonly userMessage: UserText                            // users and agents
  readonly isRetryable: boolean
  readonly retryAfter?: Duration.Duration | undefined
  readonly [ErrorReporter.severity]: "Info" | "Warn"
}

export const toPublicError = (e: DomainError): typeof PublicError.Type => ({ ... })
```

| Field | Audience | Rule |
| --- | --- | --- |
| `_tag` | code, UI, agents | The class name. |
| `message` | logs | May quote foreign text and ids. Says what an *operator* can do. |
| `userMessage` | users, agents | `UserText`. Follows [02 — The friend who picks up the phone](./02-writing-error-messages.md). |
| `isRetryable` | caller | Would the same request, unchanged, succeed? |
| `retryAfter` | caller | Only when we know. Encoded as `retryAfterMillis`. An infinite value is dropped. |
| severity | reporter | `"Info"` or `"Warn"`. |
| `cause` | logs | `Schema.Defect()`, only on wrapping classes. Never public. |
| context fields | getters | Typed (`team: DisplayName`, `needed: Permission`). The getters build both messages from them. |
| `details` | callers | Optional. The context fields an agent or the UI can act on, with a schema declared **per tag** in `@parley/api` and published in OpenAPI (D44). |

## What a Parley error looks like

```ts
// @parley/domain/src/contacts/errors.ts
import { Schema } from "effect"
import * as ErrorReporter from "effect/ErrorReporter"
import { DisplayName, userText, type DomainError } from "@parley/errors"

/** A contact with this email already exists in the team (unique (team_id, address) on contact emails). */
export class ContactEmailTaken
  extends Schema.TaggedError<ContactEmailTaken>()("ContactEmailTaken", {
    team: DisplayName.schema,
    email: EmailAddress,
    existing: ContactId, // for code and agents. Never interpolated into text.
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `email ${this.email} already used by contact ${this.existing}`
  }
  get userMessage() {
    return userText`Another contact in ${this.team} already uses ${this.email}. Open that contact to update it, or use a different email.`
  }
}
```

> `EmailAddress` is a branded schema in `@parley/domain`. Whether an email the user typed may be interpolated into `UserText` is an open question below. It isn't foreign *error* text, but it is input we didn't write.

## A proposed v1 error catalog

This is a **proposal** for the errors contacts and companies v1 can actually produce. Each class is one error with one fixer. Items marked *(proposal)* depend on product decisions you haven't made yet.

### Authentication: "who is knocking?"

These come from the entrypoint's authentication step, before any team is known.

| Class | When | `isRetryable` | Severity | Note |
| --- | --- | :-: | :-: | --- |
| `SessionMissing` | No session cookie on a web request | false | Info | The web redirects to sign-in. |
| `SessionExpired` | The cookie is present but the session ended | false | Info | "Sign in again." Distinct from missing so the UI can say "your session ended" and keep the draft. |
| `ApiKeyUnrecognized` | The API key doesn't match any API key | false | Info | Never says *why* (malformed vs. unknown). That would help guessing. |
| `ApiKeyExpired` | The API key passed its expiry | false | Info | Names who can issue a new one. |
| `ApiKeyRevoked` | The API key was revoked | false | Info | Different fixer from expired: someone *chose* this, so "ask whoever manages API keys in your team". |

### Team and authorization: "may they do this, here?"

These come only from `core/src/proofs/` (see [04](./04-authorization-proofs.md)).

| Class | When | `isRetryable` | Severity | Note |
| --- | --- | :-: | :-: | --- |
| `NotATeamMember` | The principal isn't a member of that team, **or the team doesn't exist** | false | Info | One class, one answer, sent as 404 (D35). Probing team ids reveals nothing. The log message says which case it was. |
| `RoleLacksPermission` | The member's **role** doesn't grant the permission (a `member` trying `members:manage`) | false | Info | Fixer: **a team admin or owner** changes the role. |
| `ApiKeyScopeExcludes` | The role allows it, but the **API key's scopes** don't (a read-only API key trying `records:write`) | false | Info | Fixer: **whoever created the API key** creates a wider one. |

Why are the last two separate classes? Because they have **different fixers**. Sending a read-only agent's owner to an admin to ask for a role change is a dead end: the role was never the problem. For the agent, the difference is actionable too. `ApiKeyScopeExcludes` means "stop trying writes with this API key", while `RoleLacksPermission` means "this principal cannot do this here at all". Both carry `needed: Permission`.
### Records: "does the thing exist, in *this* team?"

| Class | When | `isRetryable` | Severity | Note |
| --- | --- | :-: | :-: | --- |
| `ContactNotFound` | No contact with that id **in this team** that hasn't been deleted | false | Info | Also returned when the id exists in *another* team, when the contact is deleted, and when restoring a contact that has been purged. We never confirm existence across teams. |
| `CompanyNotFound` | Same, for companies | false | Info | Same rule. |
| `ContactEmailTaken` | Another contact in the team already has that email address (D24) | false | Info | Also possible on **restore**, if someone reused the address while the contact was deleted. Carries the existing contact's id and display name so the UI can offer "open Sam Lee". |
| `CompanyDomainTaken` | Another company in the team already has that domain (D25) | false | Info | Same shape as `ContactEmailTaken`, including on restore. |
| `ContactNotDeleted` / `CompanyNotDeleted` *(proposal)* | Restoring a record that isn't deleted | false | Info | Or make restore idempotent and drop these. |
| `CustomFieldNotFound` | No custom field with that id in this team | false | Info | Also when a write sets a value for a custom field that has since been deleted. That has a different fix from a bad value (re-read the team's custom fields), so it's its own class rather than an `InputRejected` problem. |
| `CustomFieldNameTaken` *(proposal)* | Another custom field on the same record type already has that name | false | Info | Two fields called "Industry" on contacts would make every filter and form ambiguous. |

There's no "already affiliated" error: affiliating a contact with a company it's already affiliated with returns the existing affiliation, updating the title if one is given (D43). Agents can retry safely.

A deleted record is gone as far as every operation except restore is concerned, so there's no `ContactDeleted` class. Within 30 days, restore is the only way back, and its error is `ContactNotFound` once the record is purged.

Not-found errors carry the requested id as a typed field (for agents), and never put it in the text.

### Input: "is the request well-formed?"

This is where most systems leak. Schema's default decode messages say things like `Expected string, got 42` at path `["patch", "email"]`, which is useful to a developer and useless (or confusing) to a user. Our design:

**One class, `InputRejected`, carrying a list of field problems.** One class per field would explode the union for no gain, because every field problem has the same fixer (the caller) and the same retry rule (never).

```ts
export class InputRejected extends Schema.TaggedError<InputRejected>()("InputRejected", {
  problems: Schema.Array(FieldProblem),
}) implements DomainError { ... }   // isRetryable = false, severity "Info"

export const FieldProblem = Schema.Struct({
  field: Schema.String,            // our schema's key path, e.g. "email" or "addresses.0.postcode"
  problem: Schema.Literals(["missing", "not-allowed", "wrong-type", "too-short", "too-long", "invalid-format", "out-of-range"]),
  userMessage: UserText.schema,    // "Email isn't a valid email address."
})
```

How a decode error becomes this, in one classifier (`core/src/input/classify.ts`):

1. Walk the leaf issues of the Schema decode error.
2. Map each leaf to the small `problem` vocabulary.
3. Build `userMessage` from a **`label` annotation we write on every input field** (`label: "Email"`) plus fixed words per `problem`. Unlabeled fields fall back to a generic "This field".
4. **Never** include the offending input value, and **never** include Schema's own message.

The `field` path *is* ours: it's a key in our schema, not foreign text. So it's safe and very useful to agents ("fix `addresses.0.postcode`").

Over HTTP it's **422** (D26): the request was well-formed, but its content was rejected. Malformed JSON never reaches an operation, so it gets a fixed 400 from the entrypoint.

**Custom field values use the same class.** A value that doesn't fit its custom field's type (text in a number field, an option a single select doesn't have) is fixed by the caller, never retryable, and shown next to the field, exactly like a built-in field. So it's an `InputRejected` problem at the path `customFields.<fieldId>`. The label is the custom field's name, read from its record as a `DisplayName`. The same goes for cross-field rules such as "exactly one primary email".

### Infrastructure: "something outside us went wrong"

| Class | When | `isRetryable` | Severity | Note |
| --- | --- | :-: | :-: | --- |
| `RequestsTooFrequent` | An API key exceeded its rate limit (D47) | **true** | Warn | Carries `retryAfter`, sent as `retryAfterMillis` and HTTP 429. The limit is generous; it exists to stop a runaway agent loop. |
| `DatabaseUnavailable` | Connection refused or dropped, pool exhausted, statement timeout | **true** | Warn | `cause: Schema.Defect()`. "Your changes weren't saved. Try again in a moment." |
| `AuthProviderUnavailable` *(proposal)* | Better-Auth's storage couldn't be read during authentication | true | Warn | Only if we see it in practice. Don't invent errors. |

### External provider: Resend *(v2 proposal)*

Resend is the default email provider for v2 sending. It's the clearest example of a foreign error, so here's how it will look. The class list is a **proposal for v2**, not v1 scope.

| Class | When | `isRetryable` | Severity | Note |
| --- | --- | :-: | :-: | --- |
| `EmailProviderRateLimited` | Resend answers 429 | true | Warn | `retryAfter` comes from Resend's `retry-after` header when present. |
| `EmailProviderUnreachable` | Network error, timeout, or 5xx | true | Warn | "We couldn't reach our email service. Nothing was sent. Try again in a few minutes." |
| `SendingDomainNotVerified` | Resend refuses the `from` domain | false | Info | Fixer: a team admin verifies the domain in settings. |
| `EmailProviderCredentialsRejected` | Our Resend API key was rejected | false | Warn | Only an operator can fix this, so the remedy goes in `message`. |

```ts
// @parley/core/src/email/resend.ts: the classifier sits next to the call
const send = Effect.fn("Resend.send")(function* (email: OutgoingEmail) {
  return yield* Effect.tryPromise({
    try: () => resend.emails.send(toResendPayload(email)),
    catch: (cause) => classifyResendError(cause, email), // -> one of the classes above, or dies
  })
})

/** Resend answered 429 for sending too often. */
export class EmailProviderRateLimited
  extends Schema.TaggedError<EmailProviderRateLimited>()("EmailProviderRateLimited", {
    cause: Schema.Defect(),
    retryAfter: Schema.optional(Schema.Duration),
  })
  implements DomainError
{
  readonly isRetryable = true
  override readonly [ErrorReporter.severity] = "Warn" as const
  override get message() { return `Resend rate limited: ${describe(this.cause)}` } // Resend's text lives only here
  get userMessage() {
    const minutes = this.retryAfter && Math.ceil(Duration.toMinutes(this.retryAfter))
    return minutes
      ? userText`We're sending too quickly for our email service right now. Nothing was lost. We'll try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
      : userText`We're sending too quickly for our email service right now. Nothing was lost. We'll try again shortly.`
  }
}
```

Note the wording: "our email service", not "Resend is limiting you". We don't name or blame the provider in user text (see [02](./02-writing-error-messages.md)). Resend's own text appears only in `message`, for logs.

A constraint violation is **not** `DatabaseUnavailable`. The classifier next to the insert recognizes `23505` on `contact_emails_team_id_address_key` and produces `ContactEmailTaken`. Anything the classifier can't place becomes a defect, because an unexpected database error is a bug, not a user-facing condition.

## Operation error unions

Every operation declares exactly what can go wrong, and the union composes from the layers it touches:

```ts
// @parley/domain/src/contacts/update.ts
export const UpdateContactError = Schema.Union([
  // from the entrypoint's authentication
  SessionMissing, SessionExpired, ApiKeyUnrecognized, ApiKeyExpired, ApiKeyRevoked,
  // from proofs
  NotATeamMember, RoleLacksPermission, ApiKeyScopeExcludes,
  // from the service
  InputRejected, ContactNotFound, ContactEmailTaken,
  // from infrastructure
  RequestsTooFrequent, DatabaseUnavailable,
])
export type UpdateContactError = typeof UpdateContactError.Type
export const isUpdateContactError = Schema.is(UpdateContactError)
```

In practice we'll build these from shared pieces (`AuthenticationError`, `AuthorizationError`) so each operation lists only what's new. The point is that the union is **explicit and closed**. When `contacts.update` gains an error, its type changes, and every entrypoint that handles it stops compiling.

## Where errors come from

- **External calls** use `Effect.tryPromise` with a `catch` that classifies. Never `Effect.promise`, which turns every rejection into a defect nobody can explain.
- **Classifiers live next to the call that can fail.** The Drizzle insert for contacts owns the knowledge that a particular constraint name means `ContactEmailTaken`.
- **A classifier returns a class from the union, or lets the error die as a defect.** There is no "unknown error" class pretending to be a domain error.
- **Bugs stay defects.** Never catch a defect and dress it up with a made-up message.

## Who retries? The caller.

`isRetryable` says whether a retry *can* help. It doesn't say whether one *should* happen right now. That depends on the caller's budget:

- **The web app** retries `isRetryable` reads quietly with TanStack Query's retry option. For writes it shows the message and a Retry button, because the user is watching and the decision is theirs.
- **An agent** gets `isRetryable` and `retryAfterMillis` in the tool result and runs its own loop.
- **The v2 email sender** (a background job) retries with an Effect `Schedule`, waiting `max(baseDelay, retryAfter)`, within a maximum wait.

No retry loops inside error classes or deep inside services. Retry lives with whoever owns the operation's time budget.

## At the entrypoints

### HTTP

The status map is a **typed record over the operation's tags**. If a new class joins `UpdateContactError`, this object is missing a key and fails to compile:

```ts
// @parley/api/src/status.ts
type Status = 401 | 403 | 404 | 409 | 422 | 429 | 503

export const updateContactStatus: Record<UpdateContactError["_tag"], Status> = {
  SessionMissing: 401, SessionExpired: 401,
  ApiKeyUnrecognized: 401, ApiKeyExpired: 401, ApiKeyRevoked: 401,
  NotATeamMember: 404,                              // D35: same answer whether or not the team exists
  RoleLacksPermission: 403, ApiKeyScopeExcludes: 403,
  InputRejected: 422,
  ContactNotFound: 404,
  ContactEmailTaken: 409,
  RequestsTooFrequent: 429,
  DatabaseUnavailable: 503,
}
```

In practice, shared pieces get shared maps that are spread in, so a typical endpoint only spells out its own tags. On the wire:

```json
HTTP/1.1 409 Conflict
{
  "error": {
    "_tag": "ContactEmailTaken",
    "userMessage": "Another contact in Acme Sales already uses jo@example.com. Open that contact to update it, or use a different email.",
    "isRetryable": false
  },
  "details": { "existing": "ctc_01J9Z…" }
}
```

`details` holds the typed context fields an agent or the UI can act on (D44). `PublicError` itself keeps a fixed shape; each tag that has something actionable declares its own `details` schema in `@parley/api`, and that schema is published in OpenAPI per error. It's never generated by encoding the class, so nothing leaks by accident:

```ts
// @parley/api/src/error-details.ts
export const ErrorDetails = {
  ContactEmailTaken:   Schema.Struct({ existing: ContactId }),
  CompanyDomainTaken:  Schema.Struct({ existing: CompanyId }),
  RoleLacksPermission: Schema.Struct({ needed: Permission }),
  ApiKeyScopeExcludes: Schema.Struct({ needed: Permission }),
  // Over HTTP, `expected` is the operation's input, generated from its schema (D143).
  InputRejected:       Schema.Struct({ problems: Schema.Array(FieldProblem), expected: Schema.optional(ExpectedInput) }),
  InternalDefect:      Schema.Struct({ referenceId: ReferenceId }),
} satisfies Partial<Record<PublicTag, Schema.Top>>
```

Rejected input over HTTP says exactly what the operation takes, so a caller can get the next request right without looking anything up (D143). `expected` holds the operation's name, description, method, path (with `{name}` for path parameters), and a JSON Schema of its query or body. It's generated from the same input schema as the OpenAPI document, never written by hand. A 405 carries the same for each method the path takes. MCP doesn't need it: a tool's input schema is already in `tools/list`.

### MCP

A tool error comes back as a tool result with `isError: true`. Its content is the encoded `PublicError` as JSON, with `details` alongside, and nothing else:

```json
{ "isError": true, "content": [{ "type": "text", "text": "{\"_tag\":\"ApiKeyScopeExcludes\",\"userMessage\":\"This API key can read records in Acme Sales but can't change them. Whoever created it can create one that allows edits.\",\"isRetryable\":false,\"details\":{\"needed\":\"records:write\"}}" }] }
```

This is where "agent-first" stops being a slogan. An agent can't squint at a red toast. It needs to know, from data, whether to retry (`isRetryable`), how long to wait (`retryAfterMillis`), whether to change its approach (`_tag`), and what to tell its user (`userMessage`). Every one of those is there, and every one is the same as what the web app gets.

The MCP server has its own exhaustive `Record<UpdateContactError["_tag"], …>` map per tool too. Even if every entry today is "send it as `isError`", it forces a decision when something new appears.

### Web

The web app is a client of `/api/v1` (see 00). TanStack Query queries and mutations receive the decoded `PublicError` and branch on `_tag`:

- `InputRejected` → put each `problems[i].userMessage` under the matching field.
- `ContactEmailTaken` → highlight the email field and link to `details.existing`.
- `SessionExpired` → keep the draft and open the sign-in sheet.
- Anything else → show `userMessage`, plus a Retry button when `isRetryable` is true.

The web app never builds its own error sentences from tags. The words come from the core so that users and agents read the same thing.

### Defects

A defect (a bug, an unclassified error) is logged in full, with cause, trace and span, under a fresh **reference id**. It's answered with one fixed authored message that includes that id (D46): *"Something on our side failed, and nothing was changed. Try again. If it keeps happening, share reference ABC123 with your Parley administrator."* As JSON: `_tag: "InternalDefect"`, `isRetryable: false`, `details: { referenceId }`. The reference id finds the full log entry; nothing else from the defect leaves the server. On a self-hosted install, "your Parley administrator" is the instance operator.

Logs, traces and error counts are emitted through OpenTelemetry. Exporting them is **opt-in and off by default**, and there's no phone-home (D49). Operators choose where they go.

### Saved errors

Some errors outlive the request (a v2 send that failed and is shown later). We store the **tag plus its context fields** and render `userMessage` when it's read (D45), so improved wording reaches old rows too.

## Enforcement

Greenfield means no allowlist. These rules apply to the whole repo from the first commit.

**Biome + GritQL rules** (`lint/*.grit`):

- `errors-implement-domain-error`: every error class is `Schema.TaggedError` and `implements DomainError`. `Data.TaggedError`, `Data.Error` and `extends Error` are rejected.
- `no-effect-promise`: use `Effect.tryPromise` and classify.
- `no-unchecked-user-text`: bans `as UserText`, `as DisplayName`, and `UserText.schema.make(...)`. `DisplayName.fromRecord` is allowed only under `core/src/services/**`.

**`@effect/language-service` diagnostics**, as errors: `unknownInEffectCatch`, `globalErrorInEffectCatch`, `globalErrorInEffectError`, `anyUnknownInErrorContext`. No `unknown` and no global `Error` in any error channel.

**Types** do the rest. `userText` rejects strings, the status maps reject missing tags, and `toPublicError` is the only function that produces a `PublicError`.

## Recipe: a new error class

- [ ] It is one error. If two causes need different fixes, make two classes.
- [ ] It's named for the condition: no `Error` suffix, no layer names (`ContactError`, `DbError`).
- [ ] It uses `Schema.TaggedError` and `implements DomainError`, and lives in `@parley/domain`.
- [ ] It has a doc comment saying when it happens, including the constraint, code or status that triggers it.
- [ ] Names shown to the reader are `DisplayName.schema` fields, branded in a service.
- [ ] It has `cause: Schema.Defect()` if, and only if, it wraps an error we didn't originate.
- [ ] It sets `isRetryable` (table below), and `retryAfter` only if we know how long.
- [ ] It sets `[ErrorReporter.severity]` to `"Info"` or `"Warn"`.
- [ ] `message` helps an operator. `userMessage` follows [02](./02-writing-error-messages.md).
- [ ] It joins its operation's error union, and every status map or MCP map that stops compiling gets handled.
- [ ] If it carries typed context an agent can act on, `@parley/api` declares that tag's `details`.

| Situation | `isRetryable` | Severity |
| --- | :-: | :-: |
| Overloaded, timed out, connection refused or dropped, rate limited | `true` | Warn |
| Bad or revoked credentials, access denied by a third party | `false` (someone must change something first) | Warn |
| Expected missing setup (no sending domain yet, in v2) | `false` | Info |
| Not found, conflict, malformed input | `false` (the same request fails the same way) | Info |
| Refused by our own rules or permissions | `false` | Info |
| A bug | Not a `DomainError`. Let it be a defect. | — |

Two more rules help. **Don't invent errors** to "complete" a union: model the ones that actually happen and that callers handle differently. And if two classes always get the same message, retry rule and severity, they may be one class.

## Open questions

Resolved: D24, D25, D26, D35, D38, D43, D44, D45 and D46 in the [decisions log](./decisions.md). Still open, each a proposal rather than a decision:

1. **Restoring a live record.** Should restoring a record that isn't deleted succeed quietly, like affiliating (D43), or fail with `ContactNotDeleted` / `CompanyNotDeleted`?
2. **Custom field names.** Must custom field names be unique per record type in a team (`CustomFieldNameTaken`)?
3. **Resend error classes (v2, deferred to v2 design).** Is the four-class split above right, and should user text ever name the email provider? The proposal is never to name it.

An email whose acceptance is unconfirmed returns `EmailDeliveryUnconfirmed` with `isRetryable: false`, even if the underlying network outage is transient. A pre-dispatch pacing outage remains `EmailServiceUnavailable` and is retryable. The broadcast worker can reconcile an unconfirmed acceptance using its persisted request and idempotency key inside the provider retention window; callers of foreground email operations do not possess that guarantee. Do not infer safe replay from the HTTP status alone.
