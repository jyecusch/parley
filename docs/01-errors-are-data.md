# Errors are data

*How Parley models expected errors across backend layers, preserves diagnostics, and gives clients authored messages. It builds on the vocabulary in [00 — One core, many entrypoints](./00-architecture.md).*

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

The agent branches on `_tag`. It sees that retrying unchanged is pointless and can find the other contact before deciding what to do. Jane, reading the agent's summary, gets a sentence that names her team, tells her what happened, and tells her what to do.

The same condition needs two accounts: enough internal context to diagnose it, and a public error that helps a caller respond safely. The architecture keeps those accounts separate without throwing either away.

## The priorities

There are two primary concerns, followed by a closely related third concern (D174):

1. **Handle non-happy paths throughout the backend.** Each service and operation declares expected errors in Effect v4's error channel. Callers must handle them deliberately or propagate them into a declared error union. Authentication, authorization, validation, storage, and external services all participate. A detailed HTTP response at the end cannot repair a backend that lost the distinction between a conflict, denied permission, an outage, and unconfirmed acceptance.
2. **Prevent unexpected text from reaching clients while preserving diagnostics.** Database, provider, and library text belongs in internal causes and log messages. Authored `UserText` and explicit public-field selection determine what users and agents receive. Sanitizing a response must not mean replacing the original error everywhere with an uninformative generic sentence. Preserve the cause on wrapping errors and useful typed context on expected refusals; log defects under a reference id.
3. **Help the user understand and recover.** A user message explains what happened, who can fix it, and a useful next step. It makes claims about saved data or safe retries only when the operation establishes those facts. [02 — The friend who picks up the phone](./02-writing-error-messages.md) develops this concern.

These priorities also guide agent-written code. Returning `error.message` is an easy accidental disclosure. Catching everything and discarding its cause hides the evidence needed to fix the system. Neither satisfies the architecture. The intended path is a typed internal error with retained diagnostics, followed by an authored public error.

Structured tags, retry guidance, and consistent response shapes help callers use this model. More precise per-tag wire schemas would improve it further. They are supporting mechanisms: the primary requirements remain backend error handling and safe public responses with useful internal diagnostics.

## Internal diagnostics and public errors

| Internal account | Public account |
| --- | --- |
| A declared error class and typed context explain the expected condition to backend callers. | `_tag`, `isRetryable`, and deliberately selected `details` guide the UI or agent. |
| `message` explains the condition to an operator; a wrapping error retains its original `cause`. | `userMessage` is built with `userText` from authored words and sanctioned values. |
| A defect retains its Effect cause and is logged under a fresh reference id. | `defectPublicError` supplies a fixed authored message and the reference id. |

`toPublicError` constructs a new object from selected public fields. It does not redact an error object in place. Keep the internal error available for diagnosis; never spread or directly encode it into a response. Supplying `details` is also a disclosure decision: `toPublicError` accepts arbitrary details and does not sanitize them.

Retaining diagnostics is not permission to dump credentials, request bodies, or unrestricted provider payloads into logs. Keep the context needed to resolve the condition within operator-controlled logging and tracing. Retaining a cause on a value does not itself emit a log or trace event; the entrypoint or worker that owns reporting must do that deliberately.

## What enforces this today

The implementation's guarantees are specific:

- [Operation builders](../packages/domain/src/operation.ts) compose shared and operation-specific error classes. The [core implementation registry](../packages/core/src/operations/registry.ts) checks each implementation's Effect success and error types against that contract.
- [Effect language-service diagnostics](../tsconfig.base.json) reject broad `unknown`, `any`, and global `Error` error channels in the patterns they check. Defects remain possible; they are outside the declared error channel.
- [`userText`](../packages/errors/src/user-text.ts) rejects arbitrary strings as interpolations. Biome's [brand-construction rule](../lint/no-unchecked-user-text.grit) blocks direct assertions and constructors matched by that rule outside the errors package.
- [`toPublicError`](../packages/errors/src/public-error.ts) omits the internal `message` and `cause`. [HTTP](../packages/http/src/respond.ts) and [MCP](../packages/mcp/src/server.ts) use it for expected errors and report defects with the separate fixed fallback.
- The [HTTP status map](../packages/api/src/status.ts) is exhaustive over registered operation error tags. [Public details](../packages/api/src/details.ts) are selected explicitly. The current shared `PublicError` schema uses a string tag and `Schema.Unknown` details; it does not express a checked union of per-tag detail schemas in OpenAPI.

These checks make the normal path difficult to misuse. They do not prove that every arbitrary response is safe, that details contain no sensitive value, or that an assertion cannot bypass a type. Review public-field selection, trusted brand construction, and new entrypoints, and test that diagnostic text stays out of client responses. A newly declared tag requires a status-map entry; an unexpected defect still requires runtime containment.

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
| Leaving the core | Expected errors use `toPublicError(error)`; defects use `defectPublicError(referenceId)`. | Both construct a public account. Directly encoding an internal error can disclose its context and cause. |
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
  operation error unions  builders compose shared errors and operation-specific classes

@parley/core
  classifiers             foreign error (Postgres, Better-Auth) -> one of our classes
  DisplayName.fromRecord  only in services, where names are read from rows

entrypoints
  @parley/api             exhaustive tag -> status map, explicit details selection
  @parley/http            sends toPublicError(e), contains defects
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
  details: Schema.optional(Schema.Unknown),
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
| `details` | callers | Optional, explicitly selected by `detailsOf` in `@parley/api`. Its current wire schema is `Schema.Unknown`; per-tag schemas remain a design goal from D44. |

## What a Parley error looks like

This is the implemented `ContactEmailTaken` class from [the domain](../packages/domain/src/errors/contacts.ts). The service constructs `email` with `EchoedInput.fromRequest` and the names with `DisplayName.fromRecord`; a raw string is not a valid interpolation.

```ts
export class ContactEmailTaken
  extends Schema.TaggedError<ContactEmailTaken>()("ContactEmailTaken", {
    team: DisplayName.schema,
    email: EchoedInput.schema,
    existing: ContactId,
    existingName: DisplayName.schema,
  })
  implements DomainError
{
  readonly isRetryable = false
  override readonly [ErrorReporter.severity] = "Info" as const
  override get message() {
    return `email already used by contact ${this.existing}`
  }
  get userMessage() {
    return userText`${this.email} is already used by ${this.existingName} in ${this.team}. Open ${this.existingName} to update it there, or use a different email.`
  }
}
```

The error retains the conflicting contact id for backend callers and selected public details. Its log message and user message serve different readers. Wrapping infrastructure errors, such as `DatabaseUnavailable`, additionally retain a `cause`; an expected conflict does not need to copy a raw database diagnostic into the public account.

## Selected implemented errors

This is a teaching subset of implemented classes, not the complete catalog. The source of truth is [the domain errors](../packages/domain/src/errors), with operation-specific unions in the registry. Earlier draft names and product questions are not evidence of implemented behavior.

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
| `CustomFieldNotFound` | No custom field with that id in this team | false | Info | Also when a write sets a value for a custom field that has since been deleted. That has a different fix from a bad value (re-read the team's custom fields), so it's its own class rather than an `InputRejected` problem. |
| `CustomFieldNameTaken` | The name conflicts with a built-in field or another custom field on that record type | false | Info | Two fields called "Industry" on contacts would make every filter and form ambiguous. |

There's no "already affiliated" error: affiliating a contact with a company it's already affiliated with returns the existing affiliation, updating the title if one is given (D43). Agents can retry safely.

Ordinary reads and edits refuse deleted records; deleted-list queries and restore are explicit paths. There is no `ContactDeleted` class. Restore accepts an already-live record and otherwise permits deleted records inside the restore window; once purged, the record is `ContactNotFound`.

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
  problem: Schema.Literals(["missing", "not-allowed", "wrong-type", "too-short", "too-long", "invalid-format", "out-of-range", "conflict"]),
  userMessage: UserText.schema,    // "Email isn't a valid email address."
})
```

How a decode error becomes this, in one classifier (`core/src/input/classify.ts`):

1. Walk the leaf issues of the Schema decode error.
2. Map each leaf to the small `problem` vocabulary.
3. Build `userMessage` from a **Schema `title` annotation we write on the input field** (`title: "Email"`) plus fixed words per `problem`. The implementation reads Schema `title` annotations, then falls back to known or humanized schema keys and finally "This field".
4. **Never** include the offending input value, and **never** include Schema's own message.

The `field` path *is* ours: it's a key in our schema, not foreign text. So it's safe and very useful to agents ("fix `addresses.0.postcode`").

`InputRejected` maps to **422** (D26). Body parsing and content-type errors are handled by the HTTP entrypoint; do not infer their status from the domain error union alone.

**Custom field values use the same class.** A value that doesn't fit its custom field's type (text in a number field, an option a single select doesn't have) is fixed by the caller, never retryable, and shown next to the field, exactly like a built-in field. So it's an `InputRejected` problem at the path `customFields.<fieldId>`. The label is the custom field's name, read from its record as a `DisplayName`. The same goes for cross-field rules such as "exactly one primary email".

### Infrastructure: "something outside us went wrong"

| Class | When | `isRetryable` | Severity | Note |
| --- | --- | :-: | :-: | --- |
| `RequestsTooFrequent` | An API key exceeded its rate limit (D47) | **true** | Warn | Carries `retryAfter`, sent as `retryAfterMillis` and HTTP 429. The limit is generous; it exists to stop a runaway agent loop. |
| `DatabaseUnavailable` | Connection refused or dropped, pool exhausted, statement timeout | **true** | Warn | `cause: Schema.Defect()`. The message asks someone making a change to check its outcome before retrying; it does not promise rollback. |

### External email provider

The implemented [email errors](../packages/domain/src/errors/email.ts) and [Mailer](../packages/core/src/mail/mailer.ts) supersede the earlier four-class Resend proposal:

| Class | Condition | `isRetryable` |
| --- | --- | :-: |
| `EmailServiceUnavailable` | A classified service outage; does not represent unconfirmed acceptance | true |
| `EmailDeliveryUnconfirmed` | The provider may have accepted the email | false |
| `EmailRejected` | A classified provider refusal | false |
| `EmailSendingTooFast` | The sending allowance is exhausted | true |
| `EmailNotConfigured` | The instance has no configured email service | false |
| `EmailBatchReplayUnsafe` | Duplicate protection no longer permits automatic batch replay | false |

Wrapping errors retain internal causes. Public messages use Parley's words; they do not quote the provider's response. A transport error after dispatch is not evidence that nothing was sent. The [durable broadcast sender](./07-background-delivery.md) can resolve some unconfirmed outcomes using its persisted payload and key; a foreground caller does not have that guarantee.

A constraint violation is **not** `DatabaseUnavailable`. The classifier next to the insert recognizes `23505` on `contact_emails_team_id_address_key` and produces `ContactEmailTaken`. Anything the classifier can't place becomes a defect, because an unexpected database error is a bug, not a user-facing condition.

## Operation error unions

An operation declares the expected errors it can propagate. Defects are separate: an error union cannot enumerate every possible bug or external condition.

The [operation builders](../packages/domain/src/operation.ts) compose authentication, input, and infrastructure errors, adding membership and permission errors for team-scoped operations. Each [operation definition](../packages/domain/src/operations/contacts.ts) lists the additional classes its implementation needs. The [implementation registry](../packages/core/src/operations/registry.ts) checks the result:

```ts
export type Implementation<Name extends OperationName> = (
  principal: Principal,
  input: OperationInput<Operations[Name]>,
) => Effect.Effect<OperationOutput<Operations[Name]>, OperationError<Operations[Name]>, OperationServices>
```

A service can handle a declared error with a meaningful recovery or propagate it. If an implementation propagates another expected error, its contract must admit that class. A new public tag also requires an entry in the exhaustive HTTP status map. MCP uses a shared conversion of the declared error to `PublicError`; it does not require a per-tool tag map.

## Where errors come from

- **Promise-based external calls** use `Effect.tryPromise` and classify their rejection. Native Effect integrations retain their typed error channel until the owning service classifies it. Do not turn all expected external errors into defects merely to avoid declaring them.
- **Classifiers live next to the call that can fail.** The Drizzle insert for contacts owns the knowledge that a particular constraint name means `ContactEmailTaken`.
- **A classifier returns a declared class or preserves the unrecognized error as a defect.** Wrapping classes retain the original cause; useful diagnostic context must survive classification. There is no catch-all "unknown error" class pretending to describe an expected condition.
- **Bugs stay defects.** Never catch a defect and dress it up with a made-up message.

## Who retries? The caller.

`isRetryable` says whether a retry *can* help. It doesn't say whether one *should* happen right now. That depends on the caller's budget:

- **The web app** retries `isRetryable` reads quietly with TanStack Query's retry option. For writes it shows the message and a Retry button, because the user is watching and the decision is theirs.
- **An agent** gets `isRetryable` and `retryAfterMillis` in the tool result and runs its own loop.
- **The broadcast sender** persists its next attempt and retries the saved payload within the bounded provider replay window. Its durable retry state and unknown-outcome rules are described in [07](./07-background-delivery.md).

No retry loops inside error classes or deep inside services. Retry lives with whoever owns the operation's time budget.

## At the entrypoints

### HTTP

The [status map](../packages/api/src/status.ts) is one typed record over the tags from all registered operation error unions. Adding a new tag without a status entry fails compilation. HTTP handlers use that map and `toPublicError` to construct the response:

```json
{
  "_tag": "Conflict",
  "error": {
    "_tag": "ContactEmailTaken",
    "userMessage": "jo@example.com is already used by Sam Lee in Acme Sales. Open Sam Lee to update it there, or use a different email.",
    "isRetryable": false,
    "details": { "existing": "2f088b24-9676-49a6-bf70-a2bc59bd21b0" }
  }
}
```

[`detailsOf`](../packages/api/src/details.ts) selects useful public fields, such as the existing contact id, a needed permission, or input field problems. It never derives details by encoding or spreading the class. Those fields still need disclosure review: `PublicError.details` is currently `Schema.Unknown`, and the converter does not validate a per-tag details schema. The proposed per-tag wire schemas in D44 would strengthen caller typing and generated documentation; they are not the mechanism that keeps the internal cause out of this response.

Rejected input over HTTP says exactly what the operation takes, so a caller can get the next request right without looking anything up (D143). `expected` holds the operation's name, description, method, path (with `{name}` for path parameters), and a JSON Schema of its query or body. It's generated from the same input schema as the OpenAPI document, never written by hand. A 405 carries the same for each method the path takes. MCP doesn't need it: a tool's input schema is already in `tools/list`.

### MCP

A tool error comes back as a tool result with `isError: true`. Its content is the encoded `PublicError` as JSON, including any selected `details`:

```json
{ "isError": true, "content": [{ "type": "text", "text": "{\"_tag\":\"ApiKeyScopeExcludes\",\"userMessage\":\"This API key can read records in Acme Sales but can't change them. Whoever created it can create one that allows edits.\",\"isRetryable\":false,\"details\":{\"needed\":\"records:write\"}}" }] }
```

This is where "agent-first" stops being a slogan. An agent can't squint at a red toast. It needs to know, from data, whether to retry (`isRetryable`), how long to wait (`retryAfterMillis`), whether to change its approach (`_tag`), and what to tell its user (`userMessage`). Every one of those is there, and every one is the same as what the web app gets.

The MCP server handles declared operation errors through the shared `toPublicError(error, detailsOf(error))` conversion. A separate cause handler logs defects under a reference id and returns `defectPublicError(referenceId)`. There is no exhaustive per-tool tag map in the implementation.

### Web

The web app is a client of `/api/v1` (see 00). Its [client](../apps/web/src/lib/client.ts) decodes `PublicError`; the [router](../apps/web/src/router.tsx) configures bounded retries for retryable queries. The following are intended presentation patterns, not a guarantee that every screen implements them:

- `InputRejected` → put each `problems[i].userMessage` under the matching field.
- `ContactEmailTaken` → highlight the email field and link to `details.existing`.
- `SessionExpired` → keep the draft and open the sign-in sheet.
- Anything else → show `userMessage`, plus a Retry button when `isRetryable` is true.

The web app never builds its own error sentences from tags. The words come from the core so that users and agents read the same thing.

### Defects

A defect is a bug or unclassified condition outside the declared expected error channel. HTTP and MCP log the Effect cause under a fresh **reference id**, then return a fixed authored `InternalDefect` public error with `isRetryable: false` and `details: { referenceId }` (D46). Nothing from the cause itself is copied into that response. On a self-hosted install, the Parley administrator is the instance operator who can find that log entry.

This preserves diagnostics without making the unknown condition a public explanation. It does not establish that a transaction rolled back, that a provider rejected a request, or that no side effect occurred. Claims about changed state and safe replay require evidence from the operation. [`defectPublicError`](../packages/errors/src/public-error.ts) asks someone making a change to check whether it went through before trying again. It does not promise rollback or recommend an unchecked replay. The database-outage message follows the same rule: an unavailable database request does not establish the outcome of all earlier work.

The production app emits structured HTTP logs and uses Effect spans and the tracer logger. The shipped server composition does not configure an OpenTelemetry exporter or an error-frequency pipeline. D49 records the intended opt-in export policy; see the [implementation status](./10-implementation-status.md).

### Saved errors

D45 calls for storing a tag plus context and rendering the user message when read. That general mechanism is not implemented: broadcast recipient and import outcomes currently persist authored user messages for some errors. They do not automatically acquire revised wording. Keep the approved design separate from that current storage behavior.

## Enforcement

The configured Biome plugins apply to TypeScript and TSX outside `packages/errors/src/**`. That package contains the trusted brand constructors; its implementation needs separate review. The rules match particular syntax, not every possible equivalent program.

**Biome + GritQL rules** (`lint/*.grit`):

- `errors-implement-domain-error`: every error class is `Schema.TaggedError` and `implements DomainError`. `Data.TaggedError`, `Data.Error` and `extends Error` are rejected.
- `no-effect-promise`: use `Effect.tryPromise` and classify.
- `no-unchecked-user-text`: rejects the direct brand assertions and constructors named in the rule. Constructing a `DisplayName` where a service reads the record remains a review requirement; this rule does not check the location of `DisplayName.fromRecord`.

**`@effect/language-service` diagnostics**, as errors: `unknownInEffectCatch`, `globalErrorInEffectCatch`, `globalErrorInEffectFailure`, `anyUnknownInErrorContext`. They check the error-channel and catch patterns covered by those diagnostics; they do not inspect every possible response or eliminate defects.

**Types and explicit conversion** protect the supported path. `userText` rejects arbitrary string interpolations, the HTTP status map rejects missing tags, and public conversion omits internal fields. These checks do not validate arbitrary `details`, detect every alternate response construction, or eliminate defects. See [what enforces this today](#what-enforces-this-today) for the limits.

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
- [ ] It joins its operation's error union, and the exhaustive HTTP status map includes any new tag. MCP uses the shared public conversion.
- [ ] If it carries context a client can act on, `detailsOf` selects only approved public fields; do not put the internal cause or log message there.
- [ ] Classification retains the cause on wrapping errors and useful context on expected refusals; reporting retains enough evidence to diagnose the condition.
- [ ] Tests cover the non-happy path and verify that diagnostic text does not appear in the public response.
- [ ] The user message makes no unsupported promise about rollback, saved edits, or safe retries.

| Situation | `isRetryable` | Severity |
| --- | :-: | :-: |
| Overloaded, timed out, connection refused or dropped, rate limited | `true` | Warn |
| Bad or revoked credentials, access denied by a third party | `false` (someone must change something first) | Warn |
| Expected missing setup (no sending domain yet, in v2) | `false` | Info |
| Not found, conflict, malformed input | `false` (the same request fails the same way) | Info |
| Refused by our own rules or permissions | `false` | Info |
| A bug | Not a `DomainError`. Let it be a defect. | — |

Two more rules help. **Don't invent errors** to "complete" a union: model the ones that actually happen and that callers handle differently. And if two classes always get the same message, retry rule and severity, they may be one class.

## Earlier proposals and current behavior

The earlier catalog's restore and custom-field-name questions are answered by the code, not pending implementations of their draft names. Public restore accepts a live record or a deleted record inside the restore window. The service returns an already-live record unchanged; a missing, foreign, or purged record produces the corresponding not-found error. `CustomFieldNameTaken` is implemented. The current email classes are listed above; their earlier proposal names are not aliases.

D44's per-tag wire detail schemas and D45's general saved-error rendering remain approved designs with incomplete implementation. See the [status inventory](./10-implementation-status.md) before relying on them.

An email whose acceptance is unconfirmed returns `EmailDeliveryUnconfirmed` with `isRetryable: false`, even if the underlying network outage is transient. A pre-dispatch pacing outage remains `EmailServiceUnavailable` and is retryable. The broadcast worker can reconcile an unconfirmed acceptance using its persisted request and idempotency key inside the provider retention window; callers of foreground email operations do not possess that guarantee. Do not infer safe replay from the HTTP status alone.
