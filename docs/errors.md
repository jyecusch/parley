# Error handling

Model expected non-happy paths throughout the backend with typed Effect error channels. Preserve internal diagnostics while controlling what clients receive, then write user messages that explain what happened and how to recover.

## Internal errors

- Define expected errors in `packages/domain/src/errors` with `Schema.TaggedError` and `DomainError`. Name the condition, such as `ContactNotFound`; do not add an `Error` suffix.
- Declare operation errors through the domain builders. Core implementations must fit the registered error union; handle an error meaningfully or propagate it.
- Classify Promise rejections with `Effect.tryPromise`; do not use `Effect.promise`. Native Effect integrations retain their typed channels until classified by the owning service.
- Recognize expected database conditions near the call that understands them. Keep useful typed context and the original cause on wrapping errors. Unrecognized conditions remain defects, rather than invented catch-all domain errors.
- Supply `message` for operators, `userMessage` for users and agents, `isRetryable`, and `ErrorReporter.severity` (`Info` or `Warn`). Bugs are defects, not expected errors.

A retained cause is not automatically a report. The owning entrypoint or worker must emit useful diagnostics deliberately. Do not dump credentials or unrestricted request/provider payloads into logs.

## Public responses

[`toPublicError`](../packages/errors/src/public-error.ts) selects public fields into a new object; never spread or directly encode an internal error. It omits internal `message` and `cause`, but accepts arbitrary `details` without sanitizing them. [`detailsOf`](../packages/api/src/details.ts) selects approved fields manually; the current wire schema does not validate details per tag. Review each disclosure.

Add new tags to the exhaustive [HTTP status map](../packages/api/src/status.ts). HTTP wraps the public error in its status body; MCP returns it as an `isError` tool result. MCP uses shared conversion, not per-tool tag maps.

HTTP and MCP log defects under a fresh reference id and send `defectPublicError`. Keep the cause internal and the reference id public. A defect or failed database request does not establish rollback or absence of earlier side effects. Do not promise that nothing changed or recommend an unchecked retry.

`isRetryable` means the same request might succeed later; it is not an operation-wide idempotency guarantee. `retryAfter` is included only when known and becomes `retryAfterMillis` publicly. Unconfirmed provider acceptance is not retryable by foreground callers; see [background delivery](runtime.md#background-delivery).

## User messages

Build messages with [`userText`](../packages/errors/src/user-text.ts). It accepts fixed literals, numbers, and the sanctioned `UserText`, `DisplayName`, `EchoedInput`, `FieldLabel`, and `ReferenceId` values. Arbitrary strings, foreign error messages, and unrelated brands are not valid interpolations.

Construct `DisplayName` where a service reads a visible name from a record. `EchoedInput` is length-capped input from the request being answered, never a stored value someone else supplied. `FieldLabel` comes from an owned schema title. These constructors are trusted; lint does not prove the origin of every branded value.

Explain what happened, who can fix it, and a useful next step. Keep provider diagnostics and technical identifiers out of user text; put actionable ids in explicitly selected details. `InputRejected` reports field paths and authored messages without echoing rejected values or Schema's diagnostic text.

Keep failed edits where the owning UI can preserve them. There is no universal recovery mechanism across navigation or re-sign-in, so make preservation claims only when that screen establishes them.

## Verification

Cover the condition the error represents and its meaningful recovery. Check that public responses omit diagnostic text while internal information remains available. Exercise defects after completed side effects when changing generic response handling; [respond.test.ts](../packages/http/test/respond.test.ts) covers this case. Test field-detail selection and retry semantics when they change.
