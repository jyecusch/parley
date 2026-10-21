import { Schema } from "effect"
import { PostalAddress } from "./address.ts"
import { CustomValues, CustomValuesPatch } from "./custom-field.ts"
import { AffiliationId, CompanyId, ContactId, TeamId, UserId } from "./ids.ts"
import { RecordType } from "./record-type.ts"
import { SocialProfiles } from "./social.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

export const EmailAddress = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
).pipe(Schema.brand("EmailAddress"))
export type EmailAddress = typeof EmailAddress.Type

/** E.164, for example +61400812337 (D34). */
export const PhoneNumber = Schema.String.check(Schema.isPattern(/^\+[1-9]\d{6,14}$/)).pipe(Schema.brand("PhoneNumber"))
export type PhoneNumber = typeof PhoneNumber.Type

const Name = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100))
const PhoneLabel = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(40))

export const ContactEmail = Schema.Struct({
  address: EmailAddress.annotate({ title: "Email" }),
  isPrimary: Schema.Boolean,
})
export type ContactEmail = typeof ContactEmail.Type

export const ContactPhone = Schema.Struct({
  number: PhoneNumber.annotate({ title: "Phone" }),
  label: Schema.NullOr(PhoneLabel.annotate({ title: "Phone label" })),
})
export type ContactPhone = typeof ContactPhone.Type

/** One of a contact's companies, as the contact shows it (D29, D69). */
export const ContactAffiliation = Schema.Struct({
  id: AffiliationId,
  companyId: CompanyId,
  companyName: Schema.String,
  title: Schema.NullOr(Schema.String),
})
export type ContactAffiliation = typeof ContactAffiliation.Type

export const Contact = Schema.Struct({
  id: ContactId,
  teamId: TeamId,
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  /** First and last name, falling back to the primary email (D33). */
  displayName: Schema.String,
  emails: Schema.Array(ContactEmail),
  phones: Schema.Array(ContactPhone),
  /** Where the contact is (D128), or null. */
  address: Schema.NullOr(PostalAddress),
  /** Links to their profiles on social networks (D133). */
  socialProfiles: SocialProfiles,
  /** Its companies that aren't deleted, oldest first. */
  affiliations: Schema.Array(ContactAffiliation),
  /** Custom field values by field id (D31). */
  custom: CustomValues,
  /** The uploaded avatar, or null (D75). The web app falls back to Gravatar, then initials. */
  avatarUrl: Schema.NullOr(Schema.String),
  /** Whether the contact receives marketing email (R37). */
  subscriptionStatus: Schema.Literals(["subscribed", "unsubscribed", "bounced", "marked-as-spam"]),
  /** The record owner: the member responsible for it (D123), or null. Their name as of now. */
  ownerId: Schema.NullOr(UserId),
  ownerName: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt: Schema.NullOr(Timestamp),
})
export type Contact = typeof Contact.Type

/** The writable fields of a contact. Lists replace the whole list. */
export const ContactFields = Schema.Struct({
  firstName: Schema.optional(Schema.NullOr(Name.annotate({ title: "First name" }))),
  lastName: Schema.optional(Schema.NullOr(Name.annotate({ title: "Last name" }))),
  emails: Schema.optional(
    Schema.Array(
      Schema.Struct({
        address: EmailAddress.annotate({ title: "Email" }),
        isPrimary: Schema.optional(Schema.Boolean),
      }),
    ).check(Schema.isMaxLength(20)),
  ),
  phones: Schema.optional(
    Schema.Array(
      Schema.Struct({
        number: PhoneNumber.annotate({ title: "Phone" }),
        label: Schema.optional(Schema.NullOr(PhoneLabel.annotate({ title: "Phone label" }))),
      }),
    ).check(Schema.isMaxLength(20)),
  ),
  address: Schema.optional(Schema.NullOr(PostalAddress)),
  socialProfiles: Schema.optional(SocialProfiles.annotate({ title: "Social profiles" })),
  custom: Schema.optional(CustomValuesPatch),
  ownerId: Schema.optional(
    Schema.NullOr(
      UserId.annotate({
        title: "Contact owner",
        description:
          "The member responsible for this contact: a userId from members.list or serviceAccounts.list. Null for none.",
      }),
    ),
  ),
  subscriptionStatus: Schema.optional(
    Schema.Literals(["subscribed", "unsubscribed"]).annotate({
      title: "Subscription status",
      description:
        "Whether the contact receives marketing email. Only subscribe someone who has agreed to get it. Subscribing someone again who unsubscribed, bounced or marked mail as spam needs email:manage.",
    }),
  ),
})
export type ContactFields = typeof ContactFields.Type

export const ContactPage = Schema.Struct({
  items: Schema.Array(Contact),
  nextCursor: Schema.NullOr(Schema.String),
})
export type ContactPage = typeof ContactPage.Type

export const ActivityEntry = Schema.Struct({
  id: Schema.String,
  /** Who made the change, as shown in the app. */
  actorName: Schema.String,
  /** The API key's or connection's name when the change came through one ("Claude on my laptop"). */
  via: Schema.NullOr(Schema.String),
  /** "emailed" names the campaign in `related`. "affiliated" and "unaffiliated" name the other record in `related`; a title change is "updated" with `related`. */
  kind: Schema.Literals([
    "created",
    "updated",
    "deleted",
    "restored",
    "affiliated",
    "unaffiliated",
    "emailed",
    "unsubscribed",
    "resubscribed",
    "bounced",
    "marked-as-spam",
  ]),
  changedFields: Schema.Array(Schema.String),
  /** The other record an affiliation change was about, by its name at the time. */
  related: Schema.NullOr(
    Schema.Struct({
      recordType: Schema.Union([RecordType, Schema.Literal("campaign")]),
      id: Schema.String,
      name: Schema.String,
    }),
  ),
  /** Set when Parley made the change itself, rather than the actor asking for it directly (D105). */
  reason: Schema.NullOr(Schema.Literals(["domain-matching"])),
  /** For domain matching, the domain that matched ("acme.com") (D111). */
  matchedDomain: Schema.NullOr(Schema.String),
  /** For an unsubscribe or resubscribe from one topic, its name. Null means all marketing email. */
  topicName: Schema.NullOr(Schema.String),
  at: Timestamp,
})
export type ActivityEntry = typeof ActivityEntry.Type
