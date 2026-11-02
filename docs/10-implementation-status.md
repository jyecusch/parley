# Architecture implementation status

An approved decision records the design we chose. It does not establish that the design has been implemented. This inventory distinguishes shipped mechanisms, partially met requirements, and planned work (D175). Code and configured checks are the evidence; examples and decision numbers are not.

When changing a mechanism, update its owning chapter and this inventory. Label illustrative code and proposed checks explicitly. An enforcement claim should name the actual type, rule, runtime check, or test and describe its scope. This is a maintained audit, not an automated proof that documentation cannot drift.

| Area | Status | Evidence and limits |
| --- | --- | --- |
| Operation contracts and publication | Implemented | [Registry](../packages/domain/src/operations/index.ts), [exposure manifest](../packages/domain/src/operations/exposure.ts), and [implementation registry](../packages/core/src/operations/registry.ts). Both HTTP and MCP decisions are required. Analogous MCP targets must be directly published; equivalent capability still needs review. [09](./09-operation-exposure.md). |
| Typed errors and public conversion | Implemented, with limits | [Error contracts and converters](../packages/errors/src/public-error.ts), operation error unions, and [HTTP status map](../packages/api/src/status.ts). `UserText` guards interpolation. Selected public details remain broadly typed. [01](./01-errors-are-data.md). |
| Per-tag public detail schemas (D44) | Planned | [`PublicError.details`](../packages/errors/src/public-error.ts) is `Schema.Unknown`; [`detailsOf`](../packages/api/src/details.ts) selects fields manually. OpenAPI does not yet publish a checked union of detail schemas per tag. |
| Named values and proofs | Implemented, with limits | [Proof constructors and lifetime checks](../packages/core/src/proofs/proof.ts), provers, [compile-time misuse fixtures](../packages/core/test/mistakes.ts), and runtime tests. Names constrain argument identity; getters expire after their Effect execution. They do not inspect SQL, prevent every alias mutation, or refresh stale authorization. [04](./04-authorization-proofs.md). |
| Atomic member and invitation changes | Implemented for those operations | [MemberChanges](../packages/core/src/services/member-changes.ts) serializes proof construction and writes in one transaction. Invitation email is sent after commit. This does not serialize every team operation or make email acceptance transactional. [04](./04-authorization-proofs.md#stale-proofs-and-races). |
| Team SQL isolation | Service responsibility; RLS deferred | Services supply team predicates, selected relationships have composite foreign keys, and [cross-team tests](../packages/core/test/team-isolation.test.ts) exercise successful queries. Proofs do not add predicates or cover every relationship. D28/D166 and [04](./04-authorization-proofs.md#sql-isolation-is-a-service-responsibility). |
| Service lifetime conventions | Implemented as conventions | Shared services take team arguments; request values are supplied per execution. Effect layers declare dependencies. These conventions require review. [03](./03-tiers.md). |
| Tier markers and layer checks (D40/D41) | Planned, not implemented | There is no `TierMarker`, `processLayer`, `teamLayer`, or `requestLayer` implementation. The examples in [03](./03-tiers.md#planned-tier-check) are uncompiled design sketches. |
| Tier and proof-storage lint | Planned, not configured | No service-tier, module-state, proof-storage, or exported-prover rule is configured. Existing proof-assertion rules are narrower than a general assertion ban. See the exact [lint inventory](#configured-lint-inventory). |
| Saved errors (D45) | Partially implemented | Broadcast and import processing persist authored user messages for some outcomes. There is no general tag-plus-context store that rerenders old errors using current message code. [Broadcast sender](../packages/core/src/services/broadcast-sender.ts), [import runner](../packages/core/src/services/import-runner.ts). |
| Unsaved edits across re-sign-in (D48) | Requirement, not a general guarantee | Forms commonly retain local component state during a failed request, and broadcasts have server-side drafts. There is no universal draft persistence and re-sign-in recovery mechanism across the web app. Do not promise preservation after navigation or reload without checking the owning screen. |
| Logs and tracing (D49) | Partially implemented | The [production logger](../apps/web/src/server/logging.ts) emits structured HTTP events and uses Effect's tracer logger; services use spans. The shipped [server composition](../apps/web/src/server/app.ts) does not configure an OpenTelemetry exporter or a general error-frequency pipeline. D49's opt-in export design remains work to implement. |
| Durable broadcast delivery | Implemented | Persisted batches and exact payloads, provider idempotency keys, fenced leases, bounded replay, cancellation rules, and conservative unknown outcomes. [07](./07-background-delivery.md) records assumptions and upgrade constraints. Invitation and other foreground email are not covered by this queue. |
| Database capabilities | Implemented | Native Drizzle Effect queries, transaction ownership, and an injected node-postgres capability. [08](./08-database.md) records the pinned driver, migration transition, and validation. |

## Configured lint inventory

[`biome.json`](../biome.json) loads these GritQL plugins for TypeScript and TSX outside `packages/errors/src/**`:

| Rule | What it actually checks |
| --- | --- |
| [`errors-implement-domain-error`](../lint/errors-implement-domain-error.grit) | Matches specified error class declarations that do not use the domain error contract. |
| [`no-effect-promise`](../lint/no-effect-promise.grit) | Matches direct `Effect.promise` calls. |
| [`no-unchecked-user-text`](../lint/no-unchecked-user-text.grit) | Matches listed direct brand assertions and constructors. It does not check where `DisplayName.fromRecord` is called. |
| [`proofs-only-in-proofs`](../lint/proofs-only-in-proofs.grit) | Matches direct `defineProof(...)` calls outside `core/src/proofs/`. It is not a ban on every possible aliased factory call. |
| [`no-proof-assertion`](../lint/no-proof-assertion.grit) | Matches `as` assertions to the named proof types listed in the rule, outside `proofs/proof.ts`. It does not ban all assertions, all proof types, `satisfies`, or every alternate cast form. |
| [`no-db-outside-services`](../lint/no-db-outside-services.grit) | Matches imports from `@parley/db` outside services, auth, core composition, database implementation, and tests. Package exports do not enforce which consuming workspace may import the database package. |

Biome also rejects explicit `any` under its configured rule. Its diagnostic suppressions and trusted implementation exclusions are not a universal no-assertions guarantee. The [Effect language-service configuration](../tsconfig.base.json) supplies separate typed-error diagnostics. None of these checks inspects SQL predicates or proves public details safe.
