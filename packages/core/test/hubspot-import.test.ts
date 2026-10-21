import { describe, expect, it } from "@effect/vitest"
import { guessMapping, parseCsv, toCsv } from "@parley/domain"
import { Effect } from "effect"
import { CoreLive, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

/** HubSpot's own contact headers (a subset of its 225), in its order. */
const CONTACT_HEADERS = [
  "Record ID",
  "First Name",
  "Last Name",
  "Email",
  "Additional email addresses",
  "Phone Number",
  "Mobile Phone Number",
  "Company Name",
  "Job Title",
  "Street Address",
  "City",
  "State/Region",
  "Postal Code",
  "Country/Region",
  "Create Date",
  "Contact owner",
  "Unsubscribed from all email",
  "Opted out of email: Marketing emails",
  "Email hard bounce reason",
  "Opted out of email: Suga Early Access Notices",
  "IP City",
]

describe("importing a HubSpot export", () => {
  it.effect("contacts: address, created date, consent, topics and owners come across (D125–D129)", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const topic = yield* run["topics.create"](f.jane, { teamId: f.acme, name: "Suga Early Access Notices" })
      const already = yield* run["contacts.create"](f.jane, {
        teamId: f.acme,
        firstName: "Old",
        emails: [{ address: "old@nitric.io" as never }],
      })
      const csv = toCsv([
        CONTACT_HEADERS,
        // Everything filled; owned by someone who's left, who maps to Sam; left the Suga topic.
        [
          "19101",
          "Jye",
          "Cusch",
          "jye@nitric.io",
          "jye@suga.app",
          "+61400000001",
          "0400 000 002",
          "Nitric Pty Ltd",
          "CEO and Co-Founder",
          "264 George Street",
          "Sydney",
          "New South Wales",
          "2000",
          "Australia",
          "2021-06-15 14:50",
          "Matt Stoll (Deactivated User)",
          "false",
          "false",
          "",
          "true",
          "sydney",
        ],
        // Unsubscribed in one column, and an owner no one is: imported, without one.
        [
          "19102",
          "Una",
          "",
          "una@x.io",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Nobody Here",
          "false",
          "true",
          "",
          "",
          "",
        ],
        // Bounced beats unsubscribed (D125), and an existing contact can be reported as bounced.
        [
          "19103",
          "Old",
          "",
          "old@nitric.io",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Narnia",
          "",
          "",
          "true",
          "",
          "Mailbox does not exist",
          "",
          "",
        ],
      ]).replaceAll("'+", "+")
      const [headers = []] = parseCsv(csv)
      const mapping = {
        ...guessMapping(headers, "contact", []),
        "Opted out of email: Suga Early Access Notices": `topic:${topic.id}`,
      }
      expect(mapping).toMatchObject({
        "Company Name": "company",
        "Country/Region": "country",
        "Create Date": "createdAt",
        "Unsubscribed from all email": "unsubscribed",
        "Opted out of email: Marketing emails": "unsubscribed",
        "Email hard bounce reason": "bounced",
      })
      expect("IP City" in mapping).toBe(false)

      const result = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv,
        mapping,
        owners: { "Matt Stoll (Deactivated User)": f.sam.userId },
      })
      expect([result.created, result.updated, result.failed]).toEqual([2, 1, []])
      expect(
        result.warnings.map((warning) => [warning.line, warning.problems.map((problem) => problem.field)]),
      ).toEqual([
        [2, ["phone"]],
        [3, ["owner"]],
        [4, ["address.country"]],
      ])

      const list = (yield* run["contacts.list"](f.jane, { teamId: f.acme })).items
      const jye = list.find((contact) => contact.firstName === "Jye")
      expect(jye).toMatchObject({
        address: {
          line1: "264 George Street",
          city: "Sydney",
          region: "New South Wales",
          postcode: "2000",
          country: "AU",
        },
        createdAt: "2021-06-15T14:50:00.000Z",
        ownerId: f.sam.userId,
        subscriptionStatus: "subscribed",
        affiliations: [{ companyName: "Nitric Pty Ltd", title: "CEO and Co-Founder" }],
      })
      expect(jye?.emails.map((email) => email.address)).toEqual(["jye@nitric.io", "jye@suga.app"])
      // The local number without its country code was left out; the other kept.
      expect(jye?.phones.map((phone) => phone.number)).toEqual(["+61400000001"])
      const subscriptions = yield* run["contacts.subscriptions"](f.jane, {
        teamId: f.acme,
        contactId: jye?.id as never,
      })
      expect(subscriptions.topics).toEqual([{ topicId: topic.id, name: topic.name, subscribed: false }])
      const history = yield* run["contacts.activity"](f.jane, { teamId: f.acme, contactId: jye?.id as never })
      expect(history.find((entry) => entry.kind === "created")?.at).toBe("2021-06-15T14:50:00.000Z")

      expect(list.find((contact) => contact.firstName === "Una")).toMatchObject({
        subscriptionStatus: "unsubscribed",
        ownerId: null,
      })
      expect(list.find((contact) => contact.id === already.id)).toMatchObject({ subscriptionStatus: "bounced" })
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("an unknown topic or a non-member owner refuses the import before any row", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const csv = "Email,Contact owner\nzed@x.io,Someone\n"
      const topicError = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv,
        mapping: { Email: "email", "Contact owner": "topic:00000000-0000-4000-8000-000000000000" },
      }).pipe(Effect.flip)
      expect(topicError._tag).toBe("InputRejected")
      const ownerError = yield* run["contacts.import"](f.jane, {
        teamId: f.acme,
        csv,
        owners: { Someone: f.bob.userId },
      }).pipe(Effect.flip)
      expect(ownerError._tag).toBe("InputRejected")
      expect((yield* run["contacts.list"](f.jane, { teamId: f.acme, search: "zed" })).items).toEqual([])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("companies: domains, website, address, created date and owner come across", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const csv = toCsv([
        [
          "Record ID",
          "Company name",
          "Company Domain Name",
          "Additional Domains",
          "Website URL",
          "Street Address",
          "Street Address 2",
          "City",
          "State/Region",
          "Postal Code",
          "Country/Region",
          "Create Date",
          "Company owner",
          "Industry",
        ],
        [
          "6142193172",
          "Nitric Pty Ltd",
          "nitric.io",
          "suga.app;nitric.dev",
          "nitric.io",
          "264 George Street",
          "Level 1",
          "Sydney",
          "New South Wales",
          "2000",
          "Australia",
          "2021-05-26 15:37",
          "Jane",
          "Computer Software",
        ],
      ])
      const result = yield* run["companies.import"](f.jane, { teamId: f.acme, csv })
      expect([result.created, result.failed, result.warnings]).toEqual([1, [], []])
      const [nitric] = (yield* run["companies.list"](f.jane, { teamId: f.acme })).items
      expect(nitric).toMatchObject({
        name: "Nitric Pty Ltd",
        website: "https://nitric.io",
        address: {
          line1: "264 George Street",
          line2: "Level 1",
          city: "Sydney",
          region: "New South Wales",
          postcode: "2000",
          country: "AU",
        },
        createdAt: "2021-05-26T15:37:00.000Z",
        ownerId: f.jane.userId,
      })
      expect(nitric?.domains.map((entry) => entry.domain).sort()).toEqual(["nitric.dev", "nitric.io", "suga.app"])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("companies: description, size, industry, revenue and social profiles come across (D132, D133)", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const existing = yield* run["companies.create"](f.jane, {
        teamId: f.acme,
        name: "Nitric",
        domains: [{ domain: "nitric.io" as never }],
        socialProfiles: ["https://github.com/nitrictech" as never],
      })
      const csv = toCsv([
        [
          "Company name",
          "Company Domain Name",
          "Description",
          "Number of Employees",
          "Industry",
          "Year Founded",
          "Annual Revenue",
          "LinkedIn Company Page URL",
          "Linkedin handle",
          "Twitter Handle",
          "Facebook Company Page",
          "Logo URL",
        ],
        [
          "Nitric",
          "nitric.io",
          "  Cloud apps without the plumbing.  ",
          "10.0",
          "Computer Software",
          "2020",
          "1000000.0",
          "https://www.linkedin.com/company/nitrictech",
          "nitrictech",
          "nitric_io",
          "https://www.facebook.com/nitrictech",
          "",
        ],
        [
          "Suga",
          "suga.app",
          "",
          "a few",
          "",
          "20",
          "$1,500,000",
          "",
          "",
          "@suga_app",
          "not a page!",
          // A private address is never fetched (safeFetch refuses it): a warning, not a failure.
          "https://127.0.0.1/logo.png",
        ],
      ]).replaceAll("'@", "@")
      const [headers = []] = parseCsv(csv)
      const mapping = guessMapping(headers, "company", [])
      expect(mapping).toMatchObject({
        Description: "description",
        "Number of Employees": "employees",
        Industry: "industry",
        "Year Founded": "yearFounded",
        "Annual Revenue": "annualRevenue",
        "LinkedIn Company Page URL": "social:linkedin",
        "Linkedin handle": "social:linkedin",
        "Twitter Handle": "social:x",
        "Facebook Company Page": "social:facebook",
        "Logo URL": "logoUrl",
      })
      const result = yield* run["companies.import"](f.jane, { teamId: f.acme, csv, mapping })
      expect([result.created, result.updated, result.failed]).toEqual([1, 1, []])
      expect(
        result.warnings.map((warning) => [warning.line, warning.problems.map((problem) => problem.field)]),
      ).toEqual([[3, ["employees", "yearFounded", "socialProfiles.facebook", "logoUrl"]]])

      const list = (yield* run["companies.list"](f.jane, { teamId: f.acme })).items
      const nitric = list.find((company) => company.id === existing.id)
      expect(nitric).toMatchObject({
        description: "Cloud apps without the plumbing.",
        employees: 10,
        industry: "Computer Software",
        yearFounded: 2020,
        annualRevenue: 1_000_000,
        logoUrl: null,
      })
      // Added to the profiles it had, the same LinkedIn page once.
      expect(nitric?.socialProfiles).toEqual([
        "https://github.com/nitrictech",
        "https://www.linkedin.com/company/nitrictech",
        "https://x.com/nitric_io",
        "https://www.facebook.com/nitrictech",
      ])
      expect(list.find((company) => company.name === "Suga")).toMatchObject({
        description: null,
        employees: null,
        yearFounded: null,
        annualRevenue: 1_500_000,
        socialProfiles: ["https://x.com/suga_app"],
        logoUrl: null,
      })
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("contacts: a Twitter username becomes a social profile (D133)", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const csv = "Email,Twitter Username,LinkedIn URL\nana@acme.io,@ana_codes,linkedin.com/in/ana\n"
      const [headers = []] = parseCsv(csv)
      const mapping = guessMapping(headers, "contact", [])
      expect(mapping).toMatchObject({ "Twitter Username": "social:x", "LinkedIn URL": "social:linkedin" })
      const result = yield* run["contacts.import"](f.jane, { teamId: f.acme, csv, mapping })
      expect([result.created, result.failed, result.warnings]).toEqual([1, [], []])
      const [ana] = (yield* run["contacts.list"](f.jane, { teamId: f.acme, search: "ana" })).items
      // A link is kept as given, with https added.
      expect(ana?.socialProfiles).toEqual(["https://linkedin.com/in/ana", "https://x.com/ana_codes"])
    }).pipe(Effect.provide(CoreLive)),
  )
})
