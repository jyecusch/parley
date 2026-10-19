import { describe, expect, it } from "@effect/vitest"
import { parseCsv, toCsv } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("CSV", () => {
  it("parses quotes, commas and line breaks, and escapes formulas on the way out", () => {
    expect(parseCsv('﻿name,note\r\n"Lopez, Ana","said ""hi""\nthen left"\r\n\r\n')).toEqual([
      ["name", "note"],
      ["Lopez, Ana", 'said "hi"\nthen left'],
    ])
    expect(toCsv([["=SUM(A1)", "plain", "a,b"]])).toBe(`'=SUM(A1),plain,"a,b"\r\n`)
  })

  it.effect("imports contacts: creates, updates by email, affiliates by company, reports bad rows", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const plan = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Plan",
        type: "single-select",
        options: [
          { id: "free", label: "Free" },
          { id: "pro", label: "Pro" },
        ],
      })
      const existing = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Ana",
        emails: [{ address: "ana@helio.co" as never }],
      })
      const csv = [
        "First name,Last name,Email,Company,Title,Plan",
        "Ana,Lopez,ana@helio.co,Helio,CTO,Pro",
        "Ben,Ng,ben@kumo.jp,Kumo,,free",
        "Cy,,not-an-email,,,",
        "Di,,di@kumo.jp,,,Enterprise",
      ].join("\n")
      const result = yield* run["contacts.import"](f.jane, { teamId: f.acme, csv })
      expect(result.created).toBe(1)
      expect(result.updated).toBe(1)
      expect(result.failed.map((failure) => failure.line)).toEqual([4, 5])
      expect(result.failed[1]?.problems[0]?.field).toBe(`custom.${plan.id}`)

      const ana = yield* run["contacts.get"](f.jane, { teamId: f.acme, contactId: existing.id })
      expect(ana).toMatchObject({ lastName: "Lopez", custom: { [plan.id]: "pro" } })
      expect(ana.affiliations).toMatchObject([{ companyName: "Helio", title: "CTO" }])

      const exported = yield* run["contacts.export"](f.jane, {
        teamId: f.acme,
        filter: { match: "all", conditions: [{ field: `custom:${plan.id}`, operator: "is-any-of", value: ["pro"] }] },
      })
      expect(exported.count).toBe(1)
      const [header, row] = parseCsv(exported.csv)
      expect(header).toContain("Plan")
      expect(row).toEqual(expect.arrayContaining(["Ana", "Lopez", "ana@helio.co", "Helio (CTO)", "Pro"]))
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("imports companies: matches by domain, then name; refuses free email domains per row", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Old name",
        domains: [{ domain: "helio.co" as never }],
      })
      const csv = [
        "Company,Domain,Website,City,Country",
        "Helio,https://www.helio.co/about,helio.co,Sydney,au",
        "Kumo,kumo.jp,,Tokyo,JP",
        "Gmail fans,gmail.com,,,",
        "Nowhere,,,,Australia",
      ].join("\n")
      const result = yield* run["companies.import"](f.jane, { teamId: f.acme, csv })
      expect([result.created, result.updated]).toEqual([1, 1])
      expect(result.failed.map((failure) => [failure.line, failure.problems[0]?.field])).toEqual([
        [4, "row"],
        [5, "address.country"],
      ])
      const exported = yield* run["companies.export"](f.jane, { teamId: f.acme })
      const rows = parseCsv(exported.csv).slice(1)
      expect(rows.map((row) => [row[0], row[1], row[6], row[9]]).sort()).toEqual([
        ["Helio", "helio.co", "Sydney", "AU"],
        ["Kumo", "kumo.jp", "Tokyo", "JP"],
      ])
    }).pipe(Effect.provide(CoreLive)),
  )
})
