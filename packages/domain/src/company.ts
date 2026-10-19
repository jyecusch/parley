import { Schema } from "effect"
import { PhoneNumber } from "./contact.ts"
import { AffiliationId, CompanyId, ContactId, TeamId } from "./ids.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** An email domain a company owns, such as "acme.com" (D25). Stored lower-case, without "www.". */
export const Domain = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.isPattern(/^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i),
).pipe(Schema.brand("Domain"))
export type Domain = typeof Domain.Type

/** A website, http or https. */
export const Website = Schema.String.check(Schema.isMaxLength(2000), Schema.isPattern(/^https?:\/\/[^\s]+$/i)).pipe(
  Schema.brand("Website"),
)
export type Website = typeof Website.Type

const Line = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(200))

/** A postal address (D104). Country is an ISO 3166-1 alpha-2 code, such as "AU". */
export const PostalAddress = Schema.Struct({
  line1: Schema.NullOr(Line.annotate({ title: "Street" })),
  line2: Schema.NullOr(Line.annotate({ title: "Street, line 2" })),
  city: Schema.NullOr(Line.annotate({ title: "City" })),
  region: Schema.NullOr(Line.annotate({ title: "State or region" })),
  postcode: Schema.NullOr(
    Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(20)).annotate({ title: "Postcode" }),
  ),
  country: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)).annotate({
      title: "Country",
      description: "ISO 3166-1 alpha-2 code, such as AU or US.",
    }),
  ),
})
export type PostalAddress = typeof PostalAddress.Type

export const CompanyDomain = Schema.Struct({
  domain: Domain.annotate({ title: "Domain" }),
  isPrimary: Schema.Boolean,
})
export type CompanyDomain = typeof CompanyDomain.Type

export const Company = Schema.Struct({
  id: CompanyId,
  teamId: TeamId,
  /** Also its display name. */
  name: Schema.String,
  domains: Schema.Array(CompanyDomain),
  website: Schema.NullOr(Website),
  phone: Schema.NullOr(PhoneNumber),
  address: Schema.NullOr(PostalAddress),
  /** Contacts affiliated with it that aren't deleted. */
  contactCount: Schema.Number,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt: Schema.NullOr(Timestamp),
})
export type Company = typeof Company.Type

export const CompanyName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(200))

/** The writable fields of a company. Sending domains replaces the whole list. */
export const CompanyFields = Schema.Struct({
  name: Schema.optional(CompanyName.annotate({ title: "Name" })),
  domains: Schema.optional(
    Schema.Array(
      Schema.Struct({
        domain: Domain.annotate({ title: "Domain" }),
        isPrimary: Schema.optional(Schema.Boolean),
      }),
    ).check(Schema.isMaxLength(20)),
  ),
  website: Schema.optional(Schema.NullOr(Website.annotate({ title: "Website" }))),
  phone: Schema.optional(Schema.NullOr(PhoneNumber.annotate({ title: "Phone" }))),
  address: Schema.optional(Schema.NullOr(PostalAddress)),
})
export type CompanyFields = typeof CompanyFields.Type

export const CompanyPage = Schema.Struct({
  items: Schema.Array(Company),
  nextCursor: Schema.NullOr(Schema.String),
})
export type CompanyPage = typeof CompanyPage.Type

export const Title = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100))

/** A contact's link to a company, optionally with a title ("CTO") (D29). */
export const Affiliation = Schema.Struct({
  id: AffiliationId,
  contactId: ContactId,
  contactName: Schema.String,
  companyId: CompanyId,
  companyName: Schema.String,
  title: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
})
export type Affiliation = typeof Affiliation.Type
