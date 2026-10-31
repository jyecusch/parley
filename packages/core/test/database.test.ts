import { describe, expect, it } from "@effect/vitest"
import { Database } from "@parley/db"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { CoreLive } from "../src/index.ts"

describe("database", () => {
  it.effect("cuts off any statement that runs too long", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const result = yield* db.query((d) => d.execute(sql`show statement_timeout`))
      const rows = result.rows
      expect(rows[0]).toEqual({ statement_timeout: "30s" })
    }).pipe(Effect.provide(CoreLive)),
  )
})
