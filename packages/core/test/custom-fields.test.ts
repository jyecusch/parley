import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("custom fields", () => {
  it.effect("defines fields, refuses clashing names, and checks values by type", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const plan = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        name: "Plan",
        type: "single-select",
        options: [
          { id: "free", label: "Free" },
          { id: "pro", label: "Pro" },
        ],
      })
      const seats = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        name: "Seats",
        type: "number",
      })
      // Names are unique per record type, case-insensitively, and can't be built-in names (D68).
      const duplicate = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        name: "plan",
        type: "text",
      }).pipe(Effect.flip)
      expect(duplicate).toMatchObject({ _tag: "CustomFieldNameTaken", builtIn: false })
      const builtIn = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        name: "Website",
        type: "url",
      }).pipe(Effect.flip)
      expect(builtIn).toMatchObject({ _tag: "CustomFieldNameTaken", builtIn: true })
      // The same name is fine on the other record type.
      yield* run["fields.create"](f.jane, { teamId: f.acme, recordType: "contact", name: "Plan", type: "text" })

      const company = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Helio",
        custom: { [plan.id]: "pro", [seats.id]: 12 },
      })
      expect(company.custom).toEqual({ [plan.id]: "pro", [seats.id]: 12 })

      const rejected = yield* run["companies.update"](f.jane, {
        teamId: f.acme,
        companyId: company.id,
        custom: { [plan.id]: "enterprise", [seats.id]: "lots", nope: "x" },
      }).pipe(Effect.flip)
      expect(rejected._tag).toBe("InputRejected")
      if (rejected._tag === "InputRejected") {
        expect(rejected.problems.map((problem) => [problem.field, problem.problem])).toEqual([
          [`custom.${plan.id}`, "invalid-format"],
          [`custom.${seats.id}`, "wrong-type"],
          ["custom.nope", "not-allowed"],
        ])
      }

      // A patch changes only what it names; null clears.
      const cleared = yield* run["companies.update"](f.jane, {
        teamId: f.acme,
        companyId: company.id,
        custom: { [seats.id]: null },
      })
      expect(cleared.custom).toEqual({ [plan.id]: "pro" })
      const activity = yield* run["companies.activity"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(activity.at(-1)?.changedFields).toEqual(["Seats"])

      // Removing an option clears it from records; deleting a field clears its values.
      yield* run["fields.update"](f.jane, {
        teamId: f.acme,
        fieldId: plan.id,
        options: [{ id: "free", label: "Free" }],
      })
      const afterOption = yield* run["companies.get"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(afterOption.custom).toEqual({})
      yield* run["companies.update"](f.jane, { teamId: f.acme, companyId: company.id, custom: { [plan.id]: "free" } })
      yield* run["fields.delete"](f.jane, { teamId: f.acme, fieldId: plan.id })
      const afterDelete = yield* run["companies.get"](f.jane, { teamId: f.acme, companyId: company.id })
      expect(afterDelete.custom).toEqual({})

      const listed = yield* run["fields.list"](f.jane, { teamId: f.acme, recordType: "company" })
      expect(listed.map((field) => field.name)).toEqual(["Seats"])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("only fields:manage defines fields; records:write sets values", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const denied = yield* run["fields.create"](f.janeReadOnlyKey, {
        teamId: f.acme,
        recordType: "contact",
        name: "Birthday",
        type: "date",
      }).pipe(Effect.flip)
      expect(denied._tag).toBe("ApiKeyScopeExcludes")
      const birthday = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Birthday",
        type: "date",
      })
      const bad = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Kai",
        custom: { [birthday.id]: "31/12/1990" },
      }).pipe(Effect.flip)
      expect(bad._tag).toBe("InputRejected")
      const kai = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Kai",
        custom: { [birthday.id]: "1990-12-31" },
      })
      expect(kai.custom).toEqual({ [birthday.id]: "1990-12-31" })
      const otherTeam = yield* run["fields.update"](f.bob, { teamId: f.globex, fieldId: birthday.id, name: "x" }).pipe(
        Effect.flip,
      )
      expect(otherTeam._tag).toBe("CustomFieldNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )
})
