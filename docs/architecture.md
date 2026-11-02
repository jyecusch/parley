# Architecture

Parley uses TypeScript, Effect, Postgres, Drizzle, Better-Auth, and TanStack Start. Business behavior belongs in shared core operations. The web app calls HTTP; HTTP and MCP call those same operations.

## Code map

| Location | Responsibility |
| --- | --- |
| `packages/domain` | Browser-safe ids, schemas, permissions, errors, operation contracts, and exposure policy |
| `packages/errors` | Authored user text and public-error conversion |
| `packages/db` | Schema, migrations, and connection capabilities |
| `packages/core/src/operations` | Authorization and service orchestration |
| `packages/core/src/proofs` | Named values, proof construction, and permission checks |
| `packages/core/src/services` | Database access and business services |
| `packages/api` | HTTP contract, error statuses, and selected public details |
| `packages/http`, `packages/mcp` | Authentication, decoding, operation dispatch, and response encoding |
| `apps/web` | UI and server composition |

Do not put business rules in UI components or entrypoints. Database imports are restricted to core services, auth infrastructure, core composition, the database package, and tests by the matching [lint rule](../lint/no-db-outside-services.grit).

## Operation contracts

To add or change a capability:

1. Define its input/output schemas and expected errors in the [domain registry](../packages/domain/src/operations/index.ts).
2. Implement it in core and register it in the [typed implementation registry](../packages/core/src/operations/registry.ts).
3. Declare HTTP and MCP exposure in [operations/exposure.ts](../packages/domain/src/operations/exposure.ts). Every operation needs both decisions; there are no defaults.
4. Call it from the UI through `apps/web/src/lib/client.ts`; use the shared implementation for HTTP and MCP.
5. Test the meaningful allowed and refused paths.

Exposure is `included`, intentionally `excluded` with a nonblank literal reason, or, for MCP, `analogous` with a directly published target and an explanation. Missing decisions, unknown targets, self-references, chains, and cycles fail type checking. HTTP path parameters must name input fields. Review still establishes that an analogous operation provides the promised capability.

HTTP routes, OpenAPI, handlers, expected-input guidance, typed web calls, and MCP registration follow this manifest. Inclusion grants no permission. UI/API capabilities should be available directly or analogously through MCP; agents' authority comes from their principal, roles, and scopes.

Authentication/OAuth, files, images, public forms, unsubscribe links, and webhooks have separate routes and access rules. They are not automatically protected by the operation registry.

## Authorization and team isolation

Authentication produces a [Principal](../packages/core/src/principal.ts): a session, API key, or OAuth connection acting as a user or service account. [Permission checks](../packages/core/src/proofs/permissions.ts) apply role permissions, credential scopes, and, for a service-account connection, the connecting person's role. Permissions do not imply one another.

Use `named(...)` to bind the principal, team, and resource to one Effect execution. Prove membership once, derive the permissions needed, locate the resource in that team, then pass compatible proofs to services. Mint proofs only inside `core/src/proofs/`; do not assert, copy, store, or export minting capabilities to bypass this path. The [proof implementation](../packages/core/src/proofs/proof.ts) makes values opaque and expires field access when execution finishes, including interruption. It does not prevent every assertion, alias mutation, or closure capture.

Proofs record past checks. Member and invitation changes use [MemberChanges.inTeam](../packages/core/src/services/member-changes.ts) to acquire the team lock, build fresh proofs, check ownership constraints, and write in one transaction. It owns the outer transaction: enter it before other transactional work, retain its connection, and do not detach protected work into another fiber. Send invitation email after commit. This mechanism does not serialize every team operation.

Services must explicitly scope reads, writes, joins, counts, paging, exports, and bulk selections to the proven team or an already-located parent. Proof types do not inspect SQL; RLS is not enabled. Composite team foreign keys protect only their declared relationships. Foreign and missing resource ids must not reveal cross-team existence.

Use [cross-team regression tests](../packages/core/test/team-isolation.test.ts) as the model: give the principal access to both teams, seed matching values in each, assert an own-team result, and verify the other team's data stays unchanged. A membership denial alone does not test query filtering.

## Dependencies and state

Build shared services with Effect layers. Infrastructure owns configuration, connections, and resource shutdown; services receive capabilities. Pass team and request values per call. Do not capture a current team in a shared service or retain request proofs in caches, layers, or background jobs. Key shared caches by the values they actually represent and review invalidation explicitly.

Background work persists ordinary ids and intent, not proofs. Rebuild authorization where the job's policy requires it. Effect declares dependencies but does not automatically check service tiers or captured state.

## Enforcement limits

[`biome.json`](../biome.json) configures the GritQL plugins under `lint/` for TypeScript/TSX outside `packages/errors/src/**`. They match specific error declarations, `Effect.promise` calls, brand/proof assertions, direct proof-factory calls, and database imports. They are not a universal ban on assertions or aliased calls. There are no configured service-tier, module-state, proof-storage, or exported-prover checks.

[Effect language-service diagnostics](../tsconfig.base.json) check supported typed-error patterns. The implementation registry and HTTP status map check declared errors. Defects, public detail selection, SQL predicates, resource lifetimes, and unusual construction paths still require review and behavioral tests.
