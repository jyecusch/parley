import { Schema } from "effect"
import { ContactId, TeamId } from "./ids.ts"

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

export const Contact = Schema.Struct({
  id: ContactId,
  teamId: TeamId,
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  /** First and last name, falling back to the primary email (D33). */
  displayName: Schema.String,
  emails: Schema.Array(ContactEmail),
  phones: Schema.Array(ContactPhone),
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
  /** The API key's name when the change came through one ("Claude on my laptop"). */
  via: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["created", "updated", "deleted", "restored"]),
  changedFields: Schema.Array(Schema.String),
  at: Timestamp,
})
export type ActivityEntry = typeof ActivityEntry.Type
