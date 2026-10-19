import { Schema } from "effect"

export const TeamId = Schema.String.pipe(Schema.brand("TeamId"))
export type TeamId = typeof TeamId.Type

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const ApiKeyId = Schema.String.pipe(Schema.brand("ApiKeyId"))
export type ApiKeyId = typeof ApiKeyId.Type

export const ContactId = Schema.String.pipe(Schema.brand("ContactId"))
export type ContactId = typeof ContactId.Type

export const ActivityId = Schema.String.pipe(Schema.brand("ActivityId"))
export type ActivityId = typeof ActivityId.Type
