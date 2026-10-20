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

  it.effect("imports contacts: creates, updates by email, affiliates by company, reports bad rows and values", () =>
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
      // A bad email still skips the row; a value a field can't take is left out, with a warning (D126).
      expect(result.created).toBe(2)
      expect(result.updated).toBe(1)
      expect(result.failed.map((failure) => failure.line)).toEqual([4])
      expect(result.warnings.map((warning) => [warning.line, warning.problems[0]?.field])).toEqual([
        [5, `custom.${plan.id}`],
      ])

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
        "Elsewhere,,,,Narnia",
      ].join("\n")
      const result = yield* run["companies.import"](f.jane, { teamId: f.acme, csv })
      // Countries come as a code or a name (D128); one Parley doesn't know is left out, with a warning.
      expect([result.created, result.updated]).toEqual([3, 1])
      expect(result.failed.map((failure) => [failure.line, failure.problems[0]?.field])).toEqual([[4, "row"]])
      expect(result.warnings.map((warning) => [warning.line, warning.problems[0]?.field])).toEqual([
        [6, "address.country"],
      ])
      const exported = yield* run["companies.export"](f.jane, { teamId: f.acme })
      const rows = parseCsv(exported.csv).slice(1)
      expect(rows.map((row) => [row[0], row[1], row[6], row[9]]).sort()).toEqual([
        ["Elsewhere", "", "", ""],
        ["Helio", "helio.co", "Sydney", "AU"],
        ["Kumo", "kumo.jp", "Tokyo", "JP"],
        ["Nowhere", "", "", "AU"],
      ])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("exports a segment's contacts, and only from the team's own segments", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const ada = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ada" })
      yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Cy" })
      const segment = yield* run["segments.create"](f.jane, { teamId: f.acme, name: "VIPs", kind: "fixed" })
      yield* run["segments.addContacts"](f.jane, { teamId: f.acme, segmentId: segment.id, contactIds: [ada.id] })

      const exported = yield* run["contacts.export"](f.jane, { teamId: f.acme, segmentId: segment.id })
      expect(exported.count).toBe(1)
      expect(parseCsv(exported.csv)[1]).toEqual(expect.arrayContaining(["Ada"]))

      const theirs = yield* run["segments.create"](f.bob, { teamId: f.globex, name: "Theirs", kind: "fixed" })
      const refused = yield* run["contacts.export"](f.jane, { teamId: f.acme, segmentId: theirs.id }).pipe(Effect.flip)
      expect(refused._tag).toBe("SegmentNotFound")
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("sets values on every row, and adds to multi-select values when merging imports", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const products = yield* run["fields.create"](f.jane, {
        teamId: f.acme,
        recordType: "contact",
        name: "Products",
        type: "multi-select",
        options: [
          { id: "nitric", label: "Nitric Framework" },
          { id: "suga", label: "Suga Cloud" },
        ],
      })
      const target = `custom:${products.id}`
      const nitric = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv: "Name,Email\nAna Lopez,ana@merge.co\nBen Ito,ben@merge.co\n",
        set: { [target]: "Nitric Framework" },
      })
      expect(nitric.created).toBe(2)

      // A second source: Ana is in both, so she keeps Nitric and gains Suga.
      yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv: "Name,Email\nAna Lopez,ana@merge.co\n",
        set: { [target]: "Suga Cloud" },
      })
      const listed = yield* run["contacts.list"](f.jane, { teamId: f.acme })
      const ana = listed.items.find((contact) => contact.displayName === "Ana Lopez")
      const ben = listed.items.find((contact) => contact.displayName === "Ben Ito")
      expect([...((ana?.custom[products.id] as ReadonlyArray<string>) ?? [])].sort()).toEqual(["nitric", "suga"])
      expect(ben?.custom[products.id]).toEqual(["nitric"])

      // Replace uses only the file's values.
      yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv: "Name,Email\nAna Lopez,ana@merge.co\n",
        set: { [target]: "Suga Cloud" },
        multiSelect: "replace",
      })
      const replaced = yield* run["contacts.list"](f.jane, { teamId: f.acme })
      expect(replaced.items.find((contact) => contact.displayName === "Ana Lopez")?.custom[products.id]).toEqual([
        "suga",
      ])

      // A value the field doesn't have refuses the whole import before any row.
      const refused = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv: "Name,Email\nCy,cy@merge.co\n",
        set: { [target]: "Not a product" },
      }).pipe(Effect.flip)
      expect(refused._tag).toBe("InputRejected")
    }).pipe(Effect.provide(CoreLive)),
  )
})
