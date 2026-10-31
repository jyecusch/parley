# Background delivery: persist the request before sending it

A database transaction cannot include an email provider's acceptance of a request. The provider can accept a batch, then the response can disappear or the database commit can fail. Marking the batch failed would be misleading. Sending a newly rendered batch could duplicate email.

Parley's broadcast sender therefore persists the exact provider request before dispatch, then retries that request with the same idempotency key (D167). Postgres remains the queue; this does not introduce a second queue service.

## The durable unit is the whole batch

`broadcast_batches` holds one broadcast's ordered batch of at most 100 recipients. Its UUID is the provider idempotency key. Its `payload` is the serialized request body, including resolved sender, rendered content, merge values, footer, and unsubscribe URLs. Recipient rows carry the batch ID and their position in that request.

Preparation locks the broadcast and recipients, persists the batch and membership in one transaction, and commits before any network request. A retry reads those bytes instead of rendering again. Changes to contacts, settings, rendering code, or unsubscribe secrets cannot silently change a request already in flight. The request also records a digest of the configured provider credential; replay under a changed credential stops conservatively because duplicate protection across accounts cannot be assumed. The credential itself is never persisted with the batch.

`Mailer.prepareBatch` creates the wire payload. `Mailer.deliverBatch` requires its key, payload, provider identity, recipient count, and retry deadline. Its idempotency key must be parsed as a UUID, and the batch transport always sends the header. It validates the provider response: every recipient needs a nonempty, distinct provider ID in the corresponding position. A malformed or short response leaves acceptance uncertain; it cannot produce a successful row with a missing ID.

[Resend retains idempotency keys for 24 hours and treats a batch as one request](https://resend.com/docs/dashboard/emails/idempotency-keys). Parley records the first possible dispatch before calling the provider and permits automatic replay for 23 hours 55 minutes from that time, leaving a five-minute margin. It checks the deadline again after waiting for provider pacing. HTTP requests have a 30-second timeout and support interruption. These guarantees assume normally synchronized server clocks and the provider honoring its documented retention contract.

## A lease grants temporary ownership

Claiming a pending batch assigns a fresh `claim_token` and a ten-minute `lease_until`. `FOR UPDATE SKIP LOCKED` lets servers claim different work without waiting on each other. Team selection rotates within each worker; there is no promise of strict global round-robin fairness across servers.

Before dispatch, the worker records the first-attempt time and increments attempts only if its token still matches and its lease is live. Completion, terminal outcomes, and retry scheduling use the same conditions. Lease checks use the database's current clock, rather than a transaction's fixed start time.

Preparation assigns recipient positions in one bulk update. A successful completion changes the batch, recipient rows, provider IDs, and contact activity in one transaction; the recipient update and activity insertion share one SQL statement. Database work stays bounded by batch count rather than recipient count. If that transaction fails, the durable batch remains pending. After the lease expires, another worker replays the same request and key. A late worker cannot overwrite the new owner's result or append duplicate activity. The provider key protects the network side; the claim token protects database writes. Neither replaces the other.

`EmailDeliveryUnconfirmed` reports uncertain provider acceptance and is not retryable by foreground callers. The worker can retry it because it owns the saved payload and key. Transient errors retry the same batch with exponential backoff capped at 30 minutes. Rate-limit responses use the provider's retry delay. A permanent rejection on the first attempt can be reported as failed. After an earlier unresolved attempt, a later rejection cannot prove that the earlier request was never accepted: the outcome is unknown.

Once the replay window expires, or the provider credential changes, automatic replay stops and recipients show **Outcome unknown**, with an explanation. This is a terminal state for the worker, not a claim that the email failed. There is no automatic resend or manual resend button for it. An operator must establish what happened with the provider before deciding what to do next.

## Pacing belongs to the provider account

`ProviderPacing` uses `rate-limiter-flexible` with an injected `NodePgPool` and no memory fallback. Database infrastructure owns connection configuration and lifecycle (D168). Every Resend request passes through it, including foreground email and domain checks. All servers share the installation's allowance, configured by `EMAIL_BATCHES_PER_SECOND` (default 2 requests per second). A database outage stops provider requests; allowing each server an independent fallback would multiply the allowance.

The regular application `RateLimiter` keeps its existing memory fallback. Provider pacing has a different failure policy and a separate key prefix in `rate_limits`. Requests from other applications using the same provider account are outside this coordination; provider rate-limit responses still apply.

## Cancellation has a dispatch boundary

Cancellation and the first possible dispatch serialize on the broadcast row. Cancellation stops unbatched recipients and prepared batches with no recorded attempt. Once dispatch may have started, the batch stays eligible for replay even if its broadcast is canceled. That replay resolves the existing request; it must preserve the entire original batch. In-flight recipients can therefore still arrive, and a canceled broadcast can accumulate sent recipients afterward.

A broadcast becomes `sent` when no recipients remain queued; this means processing finished, not that every email was accepted or delivered. Counts retain failed, skipped, unknown, and other outcomes separately. Delivery is recorded by webhooks after provider acceptance.

## Upgrading and retaining delivery records

Stop all old broadcast workers before applying migration `20261031033107_broadcast_batches` (formerly `0030_broadcast_batches`), and restart only workers using this protocol. Old code cannot participate in claim-token fencing. Queued recipients whose old `attempts` is greater than zero become unknown: they may already have been accepted without a durable key. Never replay them automatically during the upgrade. Unattempted queued recipients remain eligible for preparation.

Payloads contain recipient information and rendered content. They remain in Postgres with the broadcast and are deleted when it is deleted; they must receive the same access, backup, and retention treatment as recipient snapshots. Do not log payloads or provider credentials.

## What the tests establish

The Postgres tests exercise lost acceptance responses, a failed completion transaction after acceptance, live-lease exclusion, stale success and error responses after another worker completes, retry-window expiry, cancellation on either side of dispatch, batch size, and missing provider results. Mailer tests check exact request bytes and keys, response validation, deadline checks after pacing, and credential changes. Separate pacing instances share one allowance and fail closed when their database is unavailable. External providers are fakes; the tests do not send email.

This secures broadcast dispatch. It does not provide unlimited exactly-once delivery, a durable webhook inbox, or durable outboxes for foreground invitations, confirmations, and test sends. Those require their own explicit protocols rather than borrowing the broadcast guarantee by implication.

`drain` scans all eligible teams before stopping when it cannot claim more work. Maintenance-only teams and invalid-recipient preparation do not imply exhaustion. Another worker's locked work is skipped; future scheduled retries and live leases are left for later polling. Database errors fail the drain instead of reporting a completed queue.
