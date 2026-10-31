import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "@effect/vitest"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Config, Effect, Redacted } from "effect"
import pg from "pg"
import { NodePgPool } from "../src/index.ts"

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url))

const migrationDatabase = Effect.gen(function* () {
  const admin = yield* NodePgPool
  const url = new URL(Redacted.value(yield* Config.Redacted("DATABASE_URL")))
  const name = `parley_migration_${crypto.randomUUID().replaceAll("-", "")}`
  url.pathname = `/${name}`
  return yield* Effect.acquireRelease(
    Effect.tryPromise(async () => {
      await admin.query(`create database "${name}"`)
      return new pg.Pool({ connectionString: url.toString(), max: 2 })
    }).pipe(Effect.orDie),
    (pool) =>
      Effect.tryPromise(async () => {
        await pool.end()
        await admin.query(`drop database "${name}"`)
      }).pipe(Effect.orDie),
  )
})

describe("Drizzle migration compatibility", () => {
  it.live("applies the complete history to an empty database and does not replay it", () =>
    Effect.gen(function* () {
      const pool = yield* migrationDatabase
      const db = drizzle({ client: pool, paramsInErrors: false })
      const expected = readMigrationFiles({ migrationsFolder })
      yield* Effect.tryPromise(() => migrate(db, { migrationsFolder }))
      const before = yield* Effect.tryPromise(() =>
        pool.query<{ name: string; hash: string }>("select name, hash from drizzle.__drizzle_migrations order by id"),
      )
      expect(before.rows).toEqual(expected.map((migration) => ({ name: migration.name, hash: migration.hash })))
      yield* Effect.tryPromise(() => migrate(db, { migrationsFolder }))
      const after = yield* Effect.tryPromise(() =>
        pool.query("select name, hash from drizzle.__drizzle_migrations order by id"),
      )
      expect(after.rows).toEqual(before.rows)
    }).pipe(Effect.scoped, Effect.provide(NodePgPool.layer)),
  )

  it.live("upgrades the old journal table, preserves application data, and applies only pending migrations", () =>
    Effect.gen(function* () {
      const pool = yield* migrationDatabase
      const db = drizzle({ client: pool, paramsInErrors: false })
      const migrations = readMigrationFiles({ migrationsFolder })
      const legacy = migrations.filter((migration) => migration.name <= "20261031033107_broadcast_batches")
      const folder = yield* Effect.acquireRelease(
        Effect.tryPromise(() => mkdtemp(join(tmpdir(), "parley-legacy-migrations-"))),
        (path) => Effect.tryPromise(() => rm(path, { recursive: true })).pipe(Effect.orDie),
      )
      yield* Effect.tryPromise(async () => {
        for (const migration of legacy) {
          const target = join(folder, migration.name)
          await mkdir(target)
          await copyFile(join(migrationsFolder, migration.name, "migration.sql"), join(target, "migration.sql"))
        }
        await migrate(db, { migrationsFolder: folder })
        await pool.query("alter table drizzle.__drizzle_migrations drop column name, drop column applied_at")
        await pool.query(
          "insert into organization(id, name, slug, created_at) values ('migration-team', 'Preserved team', 'migration-team', now())",
        )
        await pool.query(
          "insert into contacts(id, team_id, first_name, custom) values ($1, 'migration-team', 'Ada', $2)",
          ["7d846941-7c23-4434-866a-c4332a9edafe", { nested: { values: ['quoted "text"', "", null] } }],
        )
      })
      const before = yield* Effect.tryPromise(() =>
        pool.query("select id, hash, created_at from drizzle.__drizzle_migrations order by id"),
      )
      expect(before.rows).toHaveLength(31)
      yield* Effect.tryPromise(() => migrate(db, { migrationsFolder }))
      const after = yield* Effect.tryPromise(() =>
        pool.query("select id, hash, created_at, name from drizzle.__drizzle_migrations order by id"),
      )
      expect(after.rows.slice(0, legacy.length).map(({ name: _name, ...row }) => row)).toEqual(before.rows)
      expect(after.rows.map((row) => row.name)).toEqual(migrations.map((migration) => migration.name))
      const contact = yield* Effect.tryPromise(() =>
        pool.query("select first_name, custom from contacts where team_id = 'migration-team'"),
      )
      expect(contact.rows).toEqual([{ first_name: "Ada", custom: { nested: { values: ['quoted "text"', "", null] } } }])
      const team = yield* Effect.tryPromise(() =>
        pool.query("select name from organization where id = 'migration-team'"),
      )
      expect(team.rows).toEqual([{ name: "Preserved team" }])
      yield* Effect.tryPromise(() => migrate(db, { migrationsFolder }))
      const repeated = yield* Effect.tryPromise(() =>
        pool.query("select id, hash, created_at, name from drizzle.__drizzle_migrations order by id"),
      )
      expect(repeated.rows).toEqual(after.rows)
    }).pipe(Effect.scoped, Effect.provide(NodePgPool.layer)),
  )
})
