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

export const ConnectionId = Schema.String.pipe(Schema.brand("ConnectionId"))
export type ConnectionId = typeof ConnectionId.Type

export const CompanyId = Schema.String.pipe(Schema.brand("CompanyId"))
export type CompanyId = typeof CompanyId.Type

export const AffiliationId = Schema.String.pipe(Schema.brand("AffiliationId"))
export type AffiliationId = typeof AffiliationId.Type

export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

export const CustomFieldId = Schema.String.pipe(Schema.brand("CustomFieldId"))
export type CustomFieldId = typeof CustomFieldId.Type

export const InvitationId = Schema.String.pipe(Schema.brand("InvitationId"))
export type InvitationId = typeof InvitationId.Type

export const SavedViewId = Schema.String.pipe(Schema.brand("SavedViewId"))
export type SavedViewId = typeof SavedViewId.Type

export const TopicId = Schema.String.pipe(Schema.brand("TopicId"))
export type TopicId = typeof TopicId.Type

export const SegmentId = Schema.String.pipe(Schema.brand("SegmentId"))
export type SegmentId = typeof SegmentId.Type

export const TemplateId = Schema.String.pipe(Schema.brand("TemplateId"))
export type TemplateId = typeof TemplateId.Type

export const CampaignId = Schema.String.pipe(Schema.brand("CampaignId"))
export type CampaignId = typeof CampaignId.Type

export const SendingDomainId = Schema.String.pipe(Schema.brand("SendingDomainId"))
export type SendingDomainId = typeof SendingDomainId.Type
