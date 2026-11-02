# Runtime rules

## Database and migrations

[`Database`](../packages/db/src/database.ts) owns native Drizzle Effect queries and transactions on the current fiber's connection. Its query contract exposes typed `SqlError` values for service classification. Do not rebuild clients per query or move transactional work to an unrelated connection or detached fiber.

Database infrastructure resolves connection configuration and owns resource lifetime:

- `PgLive` provides the native Effect PostgreSQL capability for domain queries and transactions.
- [`NodePgPool`](../packages/db/src/node-pg-pool.ts) supplies the node-postgres API required by Better-Auth and the Postgres rate limiters. It is a separate capability, not the native Effect pool.

Inject these capabilities into services; do not give a component `DATABASE_URL` so it can construct its own pool. Keep connection/query deadlines bounded. Drizzle parameter logging is disabled, but arbitrary provider or PostgreSQL diagnostics still need safe public conversion.

Use the pinned Drizzle Kit and existing migration layout. Generate schema migrations with `bun run db:generate`; apply them with `bun run db:migrate` against a local throwaway Postgres when developing. Never rewrite applied migration SQL. Keep migration files and runtime versions compatible. Check both fresh migration and upgrade behavior when changing schema or migration infrastructure; [migration tests](../packages/db/test/migrations.test.ts) exercise the legacy layout transition.

When upgrading from the pre-batch broadcast worker, stop old workers before applying the [batch migration](../packages/db/migrations/20261031033107_broadcast_batches/migration.sql). Restart only workers that participate in claim-token fencing. Previously attempted rows become unknown and must not be automatically resent.

## Background delivery

[`BroadcastSender`](../packages/core/src/services/broadcast-sender.ts) persists exact provider requests before dispatch. A batch's saved payload, recipient membership/order, provider identity, and UUID idempotency key must stay stable across replay. Do not rerender an in-flight batch from current settings or contact data.

Claim work with a fresh claim token and a lease. Fence dispatch bookkeeping, completion, retry, and terminal writes with the current token and live lease, using the database clock. An expired worker must not overwrite a new owner's outcome or append duplicate activity.

Record the first possible dispatch before calling the provider. Replay the same bytes and key only inside the persisted provider-protection deadline, checked again after pacing. A changed provider identity or expired protection window stops automatic replay and produces an unknown outcome. A lost response is not evidence that no email was accepted.

Commit batch completion, recipient ids/status, and related activity atomically. Preserve whole-batch replay after dispatch may have begun. Cancellation stops work that has not crossed that boundary; in-flight recipients may still receive email.

[`ProviderPacing`](../packages/core/src/services/provider-pacing.ts) coordinates the provider account through Postgres and stops requests if that shared store is unavailable. The application `RateLimiter` has a separate bounded memory fallback. Sharing a pool does not require sharing outage policy; calls made by other applications remain outside this coordination.

The broadcast mechanism does not provide unlimited exactly-once delivery, a durable webhook inbox, or durable outboxes for foreground invitations, confirmation emails, and test sends. Treat each external side effect according to its actual guarantees. Do not log persisted message payloads or provider credentials.

Use [delivery regression tests](../packages/core/test/broadcast-delivery.test.ts) for lost acceptance responses, failed completion transactions, stale workers, cancellation, replay expiry, and malformed provider results. Providers are fakes; tests must not send real email.

## Public forms

The [form runtime](../packages/core/src/services/form-runtime-live.ts) handles anonymous input separately from authenticated operations. Preserve these invariants:

- Editing changes a draft; publication creates an immutable version. Submissions and consent records identify the version and wording shown.
- Unconfirmed submissions do not modify contacts. Accepted updates fill empty fields; they do not overwrite existing answers. Kept values require an explicit member action to apply.
- Re-subscribing someone who left requires email confirmation even when double opt-in is otherwise disabled. Consent boxes are never preselected. Preserve topic modes and recorded opt-outs.
- Submission responses do not disclose whether an email already belongs to a contact. Keep layered token, replay, rate-limit, honeypot, captcha, and email checks in the runtime.
- Keep the confirmation API's GET read-only; POST performs the mutation. The confirmation page posts automatically on mount. This avoids confirmation by GET-only scanners, not scanners that execute the page's JavaScript.
- Validate the typed [appearance contract](../packages/domain/src/forms.ts) and its allowed styles; do not accept arbitrary CSS. Preserve embedding-origin checks, redirect validation, and CSP restrictions.
- The [embed script](../apps/web/public/embed.js) owns host-page tracking options. Remembered tracking and click-id capture require explicit site opt-in; do not silently enable them or collect click ids on hosted forms.

Provider webhooks require signature verification. Unsubscribe and confirmation links require their scoped signed tokens. Keep these public routes' access rules explicit rather than assuming the operation exposure manifest covers them. [Form tests](../packages/core/test/forms.test.ts) cover their state transitions and protections.
