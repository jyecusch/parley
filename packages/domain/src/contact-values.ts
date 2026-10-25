import { Schema } from "effect"

/** An email address, as contacts, custom fields and forms all check it. */
export const EmailAddress = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
).pipe(Schema.brand("EmailAddress"))
export type EmailAddress = typeof EmailAddress.Type
export const isEmailAddress = Schema.is(EmailAddress)

/** E.164, for example +61400812337 (D34). */
export const PhoneNumber = Schema.String.check(Schema.isPattern(/^\+[1-9]\d{6,14}$/)).pipe(Schema.brand("PhoneNumber"))
export type PhoneNumber = typeof PhoneNumber.Type
export const isPhoneNumber = Schema.is(PhoneNumber)
