import { Schema } from "effect"
import {
  Body,
  Campaign,
  CampaignStatus,
  ContentName,
  PreviewText,
  RecipientPage,
  RecipientStatus,
  RenderedEmail,
  Subject,
  Template,
  TestRecipients,
} from "../email.ts"
import {
  CampaignIncomplete,
  CampaignNotDraft,
  CampaignNotFound,
  CampaignNotSending,
  SegmentHasNoRecipients,
  SegmentNotFound,
  SenderNotReady,
  TemplateNotFound,
  TestRecipientNotMember,
  TopicNotFound,
} from "../errors/campaigns.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { EmailErrors } from "../errors/email.ts"
import { CampaignId, ContactId, SegmentId, TeamId, TemplateId, TopicId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneTemplate = {
  ...InTeam,
  templateId: TemplateId.annotate({ description: "The template's id, from templates.list." }),
}
const OneCampaign = {
  ...InTeam,
  campaignId: CampaignId.annotate({ description: "The campaign's id, from campaigns.list." }),
}
const Content = {
  subject: Schema.optional(Subject),
  previewText: Schema.optional(PreviewText),
  body: Schema.optional(Body),
}
const PreviewContact = Schema.optional(
  ContactId.annotate({
    title: "Contact",
    description: "Fill the merge tags from this contact. Without one, sample values are used.",
  }),
)

export const listTemplates = defineTeamOperation({
  name: "templates.list",
  description: "List the team's templates: reusable content a new campaign can start from.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Template),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/templates" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getTemplate = defineTeamOperation({
  name: "templates.get",
  description: "One template, with its subject and body.",
  input: Schema.Struct(OneTemplate),
  output: Template,
  errors: [TemplateNotFound],
  http: { method: "GET", path: "/teams/:teamId/templates/:templateId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createTemplate = defineTeamOperation({
  name: "templates.create",
  description: "Save content as a template. The body is Markdown with merge tags.",
  input: Schema.Struct({ ...InTeam, name: ContentName.annotate({ title: "Name" }), ...Content }),
  output: Template,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/templates" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const updateTemplate = defineTeamOperation({
  name: "templates.update",
  description: "Change a template. Campaigns made from it earlier keep their own copy.",
  input: Schema.Struct({ ...OneTemplate, name: Schema.optional(ContentName.annotate({ title: "Name" })), ...Content }),
  output: Template,
  errors: [TemplateNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/templates/:templateId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const deleteTemplate = defineTeamOperation({
  name: "templates.delete",
  description: "Delete a template. Campaigns made from it are untouched.",
  input: Schema.Struct(OneTemplate),
  output: Template,
  errors: [TemplateNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/templates/:templateId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const previewTemplate = defineTeamOperation({
  name: "templates.preview",
  description:
    "Render a template as a recipient would get it, with the team's footer. Pass subject, previewText or body to preview unsaved changes.",
  input: Schema.Struct({ ...OneTemplate, ...Content, contactId: PreviewContact }),
  output: RenderedEmail,
  errors: [TemplateNotFound, ContactNotFound],
  http: { method: "POST", path: "/teams/:teamId/templates/:templateId/preview" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const listCampaigns = defineTeamOperation({
  name: "campaigns.list",
  description: "List the team's campaigns, most recently changed first: drafts, and ones being sent or sent.",
  input: Schema.Struct({ ...InTeam, status: Schema.optional(CampaignStatus) }),
  output: Schema.Array(Campaign),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/campaigns" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getCampaign = defineTeamOperation({
  name: "campaigns.get",
  description: "One campaign, with its content and, once it's sending, counts of what happened.",
  input: Schema.Struct(OneCampaign),
  output: Campaign,
  errors: [CampaignNotFound],
  http: { method: "GET", path: "/teams/:teamId/campaigns/:campaignId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createCampaign = defineTeamOperation({
  name: "campaigns.create",
  description:
    "Start a draft campaign, empty or from a template (its content is copied). Set its segment and, optionally, its topic.",
  input: Schema.Struct({
    ...InTeam,
    name: ContentName.annotate({ title: "Name", description: "For your team; recipients don't see it." }),
    templateId: Schema.optional(TemplateId),
    segmentId: Schema.optional(Schema.NullOr(SegmentId)),
    topicId: Schema.optional(Schema.NullOr(TopicId)),
    ...Content,
  }),
  output: Campaign,
  errors: [TemplateNotFound, SegmentNotFound, TopicNotFound],
  http: { method: "POST", path: "/teams/:teamId/campaigns" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const updateCampaign = defineTeamOperation({
  name: "campaigns.update",
  description: "Change a draft campaign. Null clears its segment or topic.",
  input: Schema.Struct({
    ...OneCampaign,
    name: Schema.optional(ContentName.annotate({ title: "Name" })),
    segmentId: Schema.optional(Schema.NullOr(SegmentId)),
    topicId: Schema.optional(Schema.NullOr(TopicId)),
    ...Content,
  }),
  output: Campaign,
  errors: [CampaignNotFound, CampaignNotDraft, SegmentNotFound, TopicNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/campaigns/:campaignId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const deleteCampaign = defineTeamOperation({
  name: "campaigns.delete",
  description: "Delete a draft campaign. Campaigns that were sent stay, as a record of what went out.",
  input: Schema.Struct(OneCampaign),
  output: Campaign,
  errors: [CampaignNotFound, CampaignNotDraft],
  http: { method: "DELETE", path: "/teams/:teamId/campaigns/:campaignId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const duplicateCampaign = defineTeamOperation({
  name: "campaigns.duplicate",
  description: "Copy any campaign, sent or not, into a new draft.",
  input: Schema.Struct(OneCampaign),
  output: Campaign,
  errors: [CampaignNotFound],
  http: { method: "POST", path: "/teams/:teamId/campaigns/:campaignId/duplicate" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const previewCampaign = defineTeamOperation({
  name: "campaigns.preview",
  description:
    "Render a campaign as a recipient would get it, with the footer. Pass subject, previewText or body to preview unsaved changes.",
  input: Schema.Struct({ ...OneCampaign, ...Content, contactId: PreviewContact }),
  output: RenderedEmail,
  errors: [CampaignNotFound, ContactNotFound],
  http: { method: "POST", path: "/teams/:teamId/campaigns/:campaignId/preview" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const testSendCampaign = defineTeamOperation({
  name: "campaigns.testSend",
  description:
    'Send a draft to members of the team to check it, labelled "[Test]". Defaults to you. Its unsubscribe link changes nothing.',
  input: Schema.Struct({
    ...OneCampaign,
    userIds: Schema.optional(TestRecipients.annotate({ title: "Members", description: "Up to 5 members' user ids." })),
    contactId: PreviewContact,
  }),
  output: Schema.Struct({ sentTo: Schema.Array(Schema.String) }),
  errors: [CampaignNotFound, ContactNotFound, TestRecipientNotMember, SenderNotReady, ...EmailErrors],
  http: { method: "POST", path: "/teams/:teamId/campaigns/:campaignId/test-send" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const sendCampaign = defineTeamOperation({
  name: "campaigns.send",
  description:
    "Send a draft to its segment now. Recipients are fixed at this moment: subscribed contacts with an email address (and still subscribed to its topic). This can't be undone, though the rest of the sending can be cancelled. Only send to people who agreed to get it.",
  input: Schema.Struct(OneCampaign),
  output: Campaign,
  errors: [
    CampaignNotFound,
    CampaignNotDraft,
    CampaignIncomplete,
    SegmentNotFound,
    SegmentHasNoRecipients,
    SenderNotReady,
  ],
  http: { method: "POST", path: "/teams/:teamId/campaigns/:campaignId/send" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:send"],
})

export const cancelCampaign = defineTeamOperation({
  name: "campaigns.cancel",
  description: "Stop sending a campaign. Emails already sent stay sent; the rest are recorded as cancelled.",
  input: Schema.Struct(OneCampaign),
  output: Campaign,
  errors: [CampaignNotFound, CampaignNotSending],
  http: { method: "POST", path: "/teams/:teamId/campaigns/:campaignId/cancel" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:send"],
})

export const listCampaignRecipients = defineTeamOperation({
  name: "campaigns.recipients",
  description:
    "Who a campaign went to, and what happened for each: sent, delivered, skipped (and why), failed, bounced.",
  input: Schema.Struct({
    ...OneCampaign,
    status: Schema.optional(RecipientStatus),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
    cursor: Schema.optional(Schema.String),
  }),
  output: RecipientPage,
  errors: [CampaignNotFound],
  http: { method: "GET", path: "/teams/:teamId/campaigns/:campaignId/recipients" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})
