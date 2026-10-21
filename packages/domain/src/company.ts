import { Schema } from "effect"
import { PostalAddress } from "./address.ts"
import { PhoneNumber } from "./contact.ts"
import { CustomValues, CustomValuesPatch } from "./custom-field.ts"
import { AffiliationId, CompanyId, ContactId, TeamId, UserId } from "./ids.ts"
import { SocialProfiles } from "./social.ts"

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
  /** What the company does, in a few sentences (D132). */
  description: Schema.NullOr(Schema.String),
  /** How many people work there (D132). */
  employees: Schema.NullOr(Schema.Number),
  industry: Schema.NullOr(Schema.String),
  yearFounded: Schema.NullOr(Schema.Number),
  /** In the team's currency (D132). */
  annualRevenue: Schema.NullOr(Schema.Number),
  /** Links to its pages on social networks (D133). */
  socialProfiles: SocialProfiles,
  /** Contacts affiliated with it that aren't deleted. */
  contactCount: Schema.Number,
  /** Custom field values by field id (D31). */
  custom: CustomValues,
  /** The uploaded logo, else the favicon fetched from the primary domain, else null (D75). */
  logoUrl: Schema.NullOr(Schema.String),
  /** The record owner: the member responsible for it (D123), or null. Their name as of now. */
  ownerId: Schema.NullOr(UserId),
  ownerName: Schema.NullOr(Schema.String),
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
  description: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(5000)).annotate({ title: "Description" })),
  ),
  employees: Schema.optional(
    Schema.NullOr(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10_000_000 })).annotate({ title: "Employees" }),
    ),
  ),
  industry: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(120)).annotate({ title: "Industry" })),
  ),
  yearFounded: Schema.optional(
    Schema.NullOr(
      Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 2100 })).annotate({ title: "Year founded" }),
    ),
  ),
  annualRevenue: Schema.optional(
    Schema.NullOr(
      Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        title: "Annual revenue",
        description: "In the team's currency.",
      }),
    ),
  ),
  socialProfiles: Schema.optional(SocialProfiles.annotate({ title: "Social profiles" })),
  custom: Schema.optional(CustomValuesPatch),
  ownerId: Schema.optional(
    Schema.NullOr(
      UserId.annotate({
        title: "Company owner",
        description:
          "The member responsible for this company: a userId from members.list or serviceAccounts.list. Null for none.",
      }),
    ),
  ),
})
export type CompanyFields = typeof CompanyFields.Type

export const CompanyPage = Schema.Struct({
  items: Schema.Array(Company),
  nextCursor: Schema.NullOr(Schema.String),
  /** How many records match, counted on the first page only (no cursor); null on later pages (D136). */
  total: Schema.NullOr(Schema.Number),
})
export type CompanyPage = typeof CompanyPage.Type

export const Title = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100))

/** A contact's link to a company, optionally with a title ("CTO") (D29). */
export const Affiliation = Schema.Struct({
  id: AffiliationId,
  contactId: ContactId,
  contactName: Schema.String,
  /** The contact's uploaded avatar (D75), or null. */
  contactAvatarUrl: Schema.NullOr(Schema.String),
  /** The contact's primary email, for its Gravatar when the team allows it (D75), or null. */
  contactEmail: Schema.NullOr(Schema.String),
  companyId: CompanyId,
  companyName: Schema.String,
  /** The company's logo (D75), as Company.logoUrl, or null. */
  companyLogoUrl: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
})
export type Affiliation = typeof Affiliation.Type
