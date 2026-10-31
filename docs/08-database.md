# Database capabilities: configure connections once, inject them where needed

Parley uses Drizzle ORM and Kit `1.0.0-rc.5`, with Effect, `@effect/sql-pg`, and `@effect/vitest` aligned at `4.1.1` (D168). The Drizzle release candidate is an explicit choice for its native Effect PostgreSQL integration.

## Native Effects through a stable database service

`@parley/db` builds Drizzle through `drizzle-orm/effect-postgres`. Query builders produce Effects directly. There is no Promise callback bridge, per-query Drizzle construction, or manual restoration of the fiber context.

`Database.query` remains the small application-facing contract: build a native Drizzle query, run it with a span, and expose the original `SqlError` for existing service-level classification. Drizzle wraps query errors in an `EffectDrizzleQueryError` containing an Effect `Cause`; the database service extracts its typed SQL error through Effect's Cause API. Unexpected non-SQL errors remain defects with their diagnostic information intact. Domain services still decide which SQL errors are expected and which indicate bugs.

Query logging is disabled and `paramsInErrors` is explicitly false for both Drizzle clients. This prevents Drizzle from adding parameter values to its error messages; it does not redact arbitrary provider diagnostics or PostgreSQL error details. The public-error conversion remains responsible for what leaves the server.

`Database.transaction` delegates to the `withTransaction` of Drizzle's own `$client`, so queries and transactions cannot be wired to different clients. Native Drizzle queries use the current fiber's transaction connection, including nested savepoints. The callback retains its own error and service requirements. Tests exercise rollback on domain errors, nested rollback, and interruption while PostgreSQL is actively executing a statement.

Authentication relation definitions use Drizzle's `defineRelations` API. Better-Auth keeps its Promise-based Drizzle client because that is the API its database integration expects; domain services use the native Effect client.

## Connection ownership belongs in infrastructure

There are two process-wide connection capabilities, both built by `DatabaseLive`:

- `PgLive` owns the native Effect PostgreSQL pool used by `SqlClient`, Drizzle Effects, and domain transactions.
- `NodePgPool` owns one shared node-postgres pool for libraries that require the `pg` API: Better-Auth and the Postgres implementation of `rate-limiter-flexible` used by `RateLimiter` and `ProviderPacing`.

Effect's native PostgreSQL pool is not a `pg.Pool`. Injecting a compatible capability is necessary; pretending these clients are interchangeable would only hide another adapter. `NodePgPool` exposes the actual library capability, not a parallel query abstraction.

Only database infrastructure resolves `DATABASE_URL`, configures connections, handles idle pool errors, and closes pools. Core services receive the relevant capability through Effect's environment. The node-postgres pool is capped at five connections. Both capabilities apply `DATABASE_STATEMENT_TIMEOUT_MS` (default 30 seconds), `DATABASE_CONNECTION_TIMEOUT_MS` (default 5 seconds, including pool acquisition), and `DATABASE_QUERY_TIMEOUT_MS` (default 31 seconds, covering stalled client-side queries). Connection and query deadlines must be positive. Native query deadlines retain the typed `SqlError` timeout contract. The production migration process owns its separate, short-lived single-connection pool. Its startup readiness check bounds each connection/query attempt to five seconds and the overall retry budget to two minutes.

Resource ownership and rate-limit policy are separate. `ProviderPacing` still stops requests if Postgres is unavailable. `RateLimiter` still falls back to bounded in-memory counts. Sharing a connection capability does not require these services to share their outage policy.

## Migration history and deployment

Drizzle Kit's official `up` command converted the existing journal-and-snapshot history into timestamped folders containing `migration.sql` and format-9 snapshots. The first snapshot contains the full schema; later snapshots contain differences. All 31 pre-upgrade SQL files retain their exact bytes and hashes.

The old data-only `0020_canceled` migration had no snapshot. Its SQL changes stored status spelling without changing the schema. Before conversion, its unchanged-schema snapshot was restored and linked between migrations 0019 and 0021. No historical SQL was rewritten.

The RC generated `20261031041944_normalize_index_predicates`, which rebuilds three partial indexes using equivalent unqualified predicates. This makes schema generation agree with the converted metadata. It preserves index names, uniqueness and filtering behavior, but it does execute index DDL and takes the associated PostgreSQL locks during deployment.

Both `bun run db:migrate` and `packages/db/src/migrate.ts` consume the converted history. The v1 migrator upgrades an existing `drizzle.__drizzle_migrations` table by recording the matching migration names. Existing migration hashes and applied IDs remain intact; only pending SQL is applied. Run the migration before starting the upgraded application. The worker shutdown requirement for the broadcast delivery upgrade still applies if that upgrade has not already been deployed.

Do not deploy the converted migration folder with the old Drizzle runtime. Folder and runtime versions must move together. Future migrations use the pinned Kit version and the new folder layout.

## Verification

The upgrade was checked against an existing throwaway database cloned before conversion and empty throwaway databases. Historical SQL hashes, migration-record mapping, application data, and public schema were compared. CLI and production migration paths produced the same public schema, and repeated runs added no migration records. Schema generation reports no further changes. The production web build and a direct native-driver query under Bun were also verified.

The migration tests recreate a legacy migration-table layout over the first 31 migrations, seed application data, upgrade with the current runtime, verify data and existing migration IDs, and repeat the migration. Separate database tests cover typed constraint details and transaction interruption. The full application suite covers authentication, HTTP, MCP, member-change concurrency, team isolation, imports, files, forms, and durable broadcast delivery through the new driver.
