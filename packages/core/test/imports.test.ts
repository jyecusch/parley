import { describe, expect, it } from "@effect/vitest"
import { Database } from "@parley/db"
import type { ImportId } from "@parley/domain"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { CoreLive, ImportRunner, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

/** A contacts file of `count` rows, line 2 onwards; `bad` lines get an email that isn't one. */
const contactsFile = (count: number, bad: ReadonlyArray<number> = []) => {
  const tag = crypto.randomUUID().slice(0, 8)
  const rows = Array.from({ length: count }, (_, index) => {
    const line = index + 2
    return `Person${line},${bad.includes(line) ? "not-an-email" : `p${line}-${tag}@example.com`},+61 400 000 ${String(line).padStart(3, "0")}`
  })
  return { csv: ["Name,Email,Phone", ...rows].join("\n"), tag }
}

const setClaim = (importId: ImportId, minutesAgo: number) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* db
      .query((d) =>
        d.execute(
          sql`update imports set claimed_at = now() - make_interval(mins => ${minutesAgo}) where id = ${importId}`,
        ),
      )
      .pipe(Effect.orDie)
  })

describe("Imports (D135)", () => {
  it.effect(
    "imports a file in parts in the background, with failures by their line in the file",
    () =>
      Effect.gen(function* () {
        const f = yield* Fixture
        const runner = yield* ImportRunner
        const { csv, tag } = contactsFile(600, [3, 400])
        const started = yield* run["imports.start"](f.jane, {
          teamId: f.acme,
          recordType: "contact",
          csv,
          fileName: "people.csv",
        })
        expect(started).toMatchObject({ status: "queued", totalRows: 600, processedRows: 0, fileName: "people.csv" })
        expect(started.startedByName).toBe("Jane")

        expect(yield* runner.drain).toBeGreaterThanOrEqual(3)
        const done = yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })
        expect(done).toMatchObject({
          status: "finished",
          processedRows: 600,
          created: 598,
          updated: 0,
          failedCount: 2,
          error: null,
          logos: null,
        })
        expect(done.failed.map((row) => row.line)).toEqual([3, 400])
        expect(done.finishedAt).not.toBeNull()

        const found = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: `p599-${tag}`, limit: 5 })
        expect(found.items.map((contact) => contact.firstName)).toEqual(["Person599"])

        // Importing the same file again updates every contact, matched by email.
        const again = yield* run["imports.start"](f.jane, { teamId: f.acme, recordType: "contact", csv })
        yield* runner.drain
        expect(yield* run["imports.get"](f.jane, { teamId: f.acme, importId: again.id })).toMatchObject({
          status: "finished",
          created: 0,
          updated: 598,
        })

        // The history lists both, newest first, without their rows.
        const history = yield* run["imports.list"](f.jane, { teamId: f.acme, recordType: "contact" })
        expect(history.slice(0, 2).map((entry) => entry.id)).toEqual([again.id, started.id])
        expect(history[1]?.failed).toEqual([])
      }).pipe(Effect.provide(CoreLive)),
    60_000,
  )

  it.effect("leaves an import another server has claimed, and takes it over once the claim is stale", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const runner = yield* ImportRunner
      const started = yield* run["imports.start"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        csv: contactsFile(10).csv,
      })
      yield* setClaim(started.id, 0)
      yield* runner.drain
      expect((yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })).status).toBe("queued")

      yield* setClaim(started.id, 10)
      yield* runner.drain
      expect(yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })).toMatchObject({
        status: "finished",
        created: 10,
      })
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("cancels an import part-way: rows already imported stay, the rest aren't", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const runner = yield* ImportRunner
      const { csv, tag } = contactsFile(600)
      const started = yield* run["imports.start"](f.jane, { teamId: f.acme, recordType: "contact", csv })
      expect(yield* runner.step).toBe(true)
      const cancelled = yield* run["imports.cancel"](f.jane, { teamId: f.acme, importId: started.id })
      expect(cancelled).toMatchObject({ status: "cancelled", processedRows: 250, created: 250 })
      yield* runner.drain
      expect(yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })).toMatchObject({
        status: "cancelled",
        processedRows: 250,
      })
      const imported = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: tag, limit: 200 })
      expect(imported.items.length).toBe(200)
      const last = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: `p251-${tag}`, limit: 5 })
      expect(last.items.length).toBe(1)
      const notImported = yield* run["contacts.list"](f.jane, { teamId: f.acme, search: `p252-${tag}`, limit: 5 })
      expect(notImported.items.length).toBe(0)

      // Cancelling again changes nothing.
      expect((yield* run["imports.cancel"](f.jane, { teamId: f.acme, importId: started.id })).status).toBe("cancelled")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("refuses a file over 100,000 rows, and settings that can't be used, before importing anything", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const tooBig = yield* run["imports.start"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        csv: `Name\n${"x\n".repeat(100_001)}`,
      }).pipe(Effect.flip)
      expect(tooBig).toMatchObject({ _tag: "InputRejected", problems: [{ field: "csv", problem: "too-long" }] })

      const badSet = yield* run["imports.start"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        csv: "Name\nAcme",
        set: { "custom:nope": "x" },
      }).pipe(Effect.flip)
      expect(badSet).toMatchObject({ _tag: "InputRejected", problems: [{ field: "set.custom:nope" }] })

      const readOnly = yield* run["imports.start"](f.janeReadOnlyKey, {
        teamId: f.acme,
        recordType: "company",
        csv: "Name\nAcme",
      }).pipe(Effect.flip)
      expect(readOnly._tag).toBe("ApiKeyScopeExcludes")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("fetches company logos after the rows, one at a time, with a warning for one it can't fetch", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const runner = yield* ImportRunner
      const name = `Logo Co ${crypto.randomUUID().slice(0, 6)}`
      const started = yield* run["imports.start"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        // A private address is never fetched (safeFetch refuses it).
        csv: `Name,Logo URL\n${name},https://127.0.0.1/logo.png\n${name} Two,`,
      })
      expect(yield* runner.step).toBe(true)
      expect(yield* runner.step).toBe(true)
      expect(yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })).toMatchObject({
        status: "fetching-logos",
        created: 2,
        logos: { total: 1, done: 0 },
      })
      yield* runner.drain
      const done = yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })
      expect(done).toMatchObject({ status: "finished", logos: { total: 1, done: 1 }, warningCount: 1 })
      expect(done.warnings).toMatchObject([{ line: 2, problems: [{ field: "logoUrl" }] }])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("stops an import when whoever started it leaves the team", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const runner = yield* ImportRunner
      const started = yield* run["imports.start"](f.sam, {
        teamId: f.acme,
        recordType: "contact",
        csv: contactsFile(5).csv,
      })
      yield* run["members.remove"](f.jane, { teamId: f.acme, userId: f.sam.userId })
      yield* runner.drain
      const stopped = yield* run["imports.get"](f.jane, { teamId: f.acme, importId: started.id })
      expect(stopped).toMatchObject({ status: "failed", created: 0 })
      expect(stopped.error).toContain("Sam can't add records to this team any more")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("keeps each team's imports to itself", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const started = yield* run["imports.start"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        csv: contactsFile(1).csv,
      })
      const theirs = yield* run["imports.get"](f.bob, { teamId: f.globex, importId: started.id }).pipe(Effect.flip)
      expect(theirs._tag).toBe("ImportNotFound")
      const cancel = yield* run["imports.cancel"](f.bob, { teamId: f.globex, importId: started.id }).pipe(Effect.flip)
      expect(cancel._tag).toBe("ImportNotFound")
      const list = yield* run["imports.list"](f.bob, { teamId: f.globex })
      expect(list.some((entry) => entry.id === started.id)).toBe(false)
      yield* (yield* ImportRunner).drain
    }).pipe(Effect.provide(CoreLive)),
  )
})
