import { describe, expect, it } from "@effect/vitest"
import type { ApiKeyId } from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { CoreLive, type Principal, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("saved views", () => {
  it.effect("personal views are private, shared views need records:write, filters are checked", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const bot = yield* run["serviceAccounts.create"](f.jane, { teamId: f.acme, name: "Reader" })
      const reader: Principal = {
        _tag: "ServiceAccountApiKey",
        userId: bot.id,
        name: DisplayName.fromRecord("Reader"),
        apiKeyId: "key_reader" as ApiKeyId,
        apiKeyName: "Reports",
        scopes: new Set(["records:read"]),
      }
      const vip = yield* run["savedViews.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Acme people",
        shared: true,
        filter: { match: "all", conditions: [{ field: "email", operator: "contains", value: "@acme" }] },
        sort: { field: "name", direction: "asc" },
      })
      expect(vip).toMatchObject({ shared: true, ownerName: "Jane", sort: { field: "name", direction: "asc" } })
      const mine = yield* run["savedViews.create"](reader, { teamId: f.acme, recordType: "contact", name: "Mine" })
      expect(mine.shared).toBe(false)

      // A read-only principal can't share, or change someone else's shared view.
      const share = yield* run["savedViews.create"](reader, {
        teamId: f.acme,
        recordType: "contact",
        name: "Ours",
        shared: true,
      }).pipe(Effect.flip)
      expect(share._tag).toBe("ApiKeyScopeExcludes")
      const edit = yield* run["savedViews.update"](reader, { teamId: f.acme, viewId: vip.id, name: "Mine now" }).pipe(
        Effect.flip,
      )
      expect(edit._tag).toBe("ApiKeyScopeExcludes")

      // Each sees shared views plus their own; nobody sees another's personal view.
      const janeSees = yield* run["savedViews.list"](f.jane, { teamId: f.acme })
      expect(janeSees.map((view) => view.name)).toEqual(["Acme people"])
      const readerSees = yield* run["savedViews.list"](reader, { teamId: f.acme })
      expect(readerSees.map((view) => view.name)).toEqual(["Acme people", "Mine"])
      const hidden = yield* run["savedViews.delete"](f.jane, { teamId: f.acme, viewId: mine.id }).pipe(Effect.flip)
      expect(hidden._tag).toBe("SavedViewNotFound")

      const bad = yield* run["savedViews.update"](f.jane, {
        teamId: f.acme,
        viewId: vip.id,
        filter: { match: "all", conditions: [{ field: "nope", operator: "is-empty" }] },
      }).pipe(Effect.flip)
      expect(bad._tag).toBe("InputRejected")
      yield* run["savedViews.delete"](f.jane, { teamId: f.acme, viewId: vip.id })
      expect(yield* run["savedViews.list"](f.jane, { teamId: f.acme })).toEqual([])
    }).pipe(Effect.provide(CoreLive)),
  )
})
