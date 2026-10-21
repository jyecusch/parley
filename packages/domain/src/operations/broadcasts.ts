import { Schema } from "effect"
import {
  Body,
  Broadcast,
  BroadcastStatus,
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
  BroadcastIncomplete,
  BroadcastNotDraft,
  BroadcastNotFound,
  BroadcastNotSending,
  SegmentHasNoRecipients,
  SegmentNotFound,
  SenderNotReady,
  TemplateNotFound,
  TestRecipientNotMember,
  TopicNotFound,
} from "../errors/broadcasts.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { EmailErrors } from "../errors/email.ts"
import { EmailStyleNotFound } from "../errors/email-styles.ts"
import { RequestsTooFrequent } from "../errors/infrastructure.ts"
import { BroadcastId, ContactId, EmailStyleId, SegmentId, TeamId, TemplateId, TopicId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneTemplate = {
  ...InTeam,
  templateId: TemplateId.annotate({ description: "The template's id, from templates.list." }),
}
const OneBroadcast = {
  ...InTeam,
  broadcastId: BroadcastId.annotate({ description: "The broadcast's id, from broadcasts.list." }),
}
const Content = {
  subject: Schema.optional(Subject),
  previewText: Schema.optional(PreviewText),
  body: Schema.optional(Body),
}
/** Which email style to use; null means the team's default (D117). */
const Style = {
  styleId: Schema.optional(
    Schema.NullOr(
      EmailStyleId.annotate({
        title: "Email style",
        description: "An email style's id, from emailStyles.list. Null uses the team's default style.",
      }),
    ),
  ),
}
const PreviewContact = Schema.optional(
  ContactId.annotate({
    title: "Contact",
    description: "Fill the merge tags from this contact. Without one, sample values are used.",
  }),
)

export const listTemplates = defineTeamOperation({
  name: "templates.list",
  description: "List the team's templates: reusable content a new broadcast can start from.",
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
  input: Schema.Struct({ ...InTeam, name: ContentName.annotate({ title: "Name" }), ...Content, ...Style }),
  output: Template,
  errors: [EmailStyleNotFound],
  http: { method: "POST", path: "/teams/:teamId/templates" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const updateTemplate = defineTeamOperation({
  name: "templates.update",
  description: "Change a template. Broadcasts made from it earlier keep their own copy.",
  input: Schema.Struct({
    ...OneTemplate,
    name: Schema.optional(ContentName.annotate({ title: "Name" })),
    ...Content,
    ...Style,
  }),
  output: Template,
  errors: [TemplateNotFound, EmailStyleNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/templates/:templateId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const deleteTemplate = defineTeamOperation({
  name: "templates.delete",
  description: "Delete a template. Broadcasts made from it are untouched.",
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
  input: Schema.Struct({ ...OneTemplate, ...Content, ...Style, contactId: PreviewContact }),
  output: RenderedEmail,
  errors: [TemplateNotFound, ContactNotFound, EmailStyleNotFound],
  http: { method: "POST", path: "/teams/:teamId/templates/:templateId/preview" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const listBroadcasts = defineTeamOperation({
  name: "broadcasts.list",
  description: "List the team's broadcasts, most recently changed first: drafts, and ones being sent or sent.",
  input: Schema.Struct({ ...InTeam, status: Schema.optional(BroadcastStatus) }),
  output: Schema.Array(Broadcast),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/broadcasts" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getBroadcast = defineTeamOperation({
  name: "broadcasts.get",
  description: "One broadcast, with its content and, once it's sending, counts of what happened.",
  input: Schema.Struct(OneBroadcast),
  output: Broadcast,
  errors: [BroadcastNotFound],
  http: { method: "GET", path: "/teams/:teamId/broadcasts/:broadcastId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createBroadcast = defineTeamOperation({
  name: "broadcasts.create",
  description:
    "Start a draft broadcast, empty or from a template (its content and email style are copied). Set its segment and, optionally, its topic and email style.",
  input: Schema.Struct({
    ...InTeam,
    name: ContentName.annotate({ title: "Name", description: "For your team; recipients don't see it." }),
    templateId: Schema.optional(TemplateId),
    segmentId: Schema.optional(Schema.NullOr(SegmentId)),
    topicId: Schema.optional(Schema.NullOr(TopicId)),
    ...Content,
    ...Style,
  }),
  output: Broadcast,
  errors: [TemplateNotFound, SegmentNotFound, TopicNotFound, EmailStyleNotFound],
  http: { method: "POST", path: "/teams/:teamId/broadcasts" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const updateBroadcast = defineTeamOperation({
  name: "broadcasts.update",
  description: "Change a draft broadcast. Null clears its segment or topic.",
  input: Schema.Struct({
    ...OneBroadcast,
    name: Schema.optional(ContentName.annotate({ title: "Name" })),
    segmentId: Schema.optional(Schema.NullOr(SegmentId)),
    topicId: Schema.optional(Schema.NullOr(TopicId)),
    ...Content,
    ...Style,
  }),
  output: Broadcast,
  errors: [BroadcastNotFound, BroadcastNotDraft, SegmentNotFound, TopicNotFound, EmailStyleNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/broadcasts/:broadcastId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const deleteBroadcast = defineTeamOperation({
  name: "broadcasts.delete",
  description: "Delete a draft broadcast. Broadcasts that were sent stay, as a record of what went out.",
  input: Schema.Struct(OneBroadcast),
  output: Broadcast,
  errors: [BroadcastNotFound, BroadcastNotDraft],
  http: { method: "DELETE", path: "/teams/:teamId/broadcasts/:broadcastId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const duplicateBroadcast = defineTeamOperation({
  name: "broadcasts.duplicate",
  description: "Copy any broadcast, sent or not, into a new draft.",
  input: Schema.Struct(OneBroadcast),
  output: Broadcast,
  errors: [BroadcastNotFound],
  http: { method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/duplicate" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const previewBroadcast = defineTeamOperation({
  name: "broadcasts.preview",
  description:
    "Render a broadcast as a recipient would get it, with the footer. Pass subject, previewText or body to preview unsaved changes.",
  input: Schema.Struct({ ...OneBroadcast, ...Content, ...Style, contactId: PreviewContact }),
  output: RenderedEmail,
  errors: [BroadcastNotFound, ContactNotFound, EmailStyleNotFound],
  http: { method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/preview" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const testSendBroadcast = defineTeamOperation({
  name: "broadcasts.testSend",
  description:
    'Send a draft to members of the team to check it, labelled "[Test]". Defaults to you. Its unsubscribe link changes nothing.',
  input: Schema.Struct({
    ...OneBroadcast,
    userIds: Schema.optional(TestRecipients.annotate({ title: "Members", description: "Up to 5 members' user ids." })),
    contactId: PreviewContact,
  }),
  output: Schema.Struct({ sentTo: Schema.Array(Schema.String) }),
  errors: [
    BroadcastNotFound,
    ContactNotFound,
    TestRecipientNotMember,
    SenderNotReady,
    RequestsTooFrequent,
    ...EmailErrors,
  ],
  http: { method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/test-send" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const sendBroadcast = defineTeamOperation({
  name: "broadcasts.send",
  description:
    "Send a draft to its segment now. Recipients are fixed at this moment: subscribed contacts with an email address (and still subscribed to its topic). This can't be undone, though the rest of the sending can be cancelled. Only send to people who agreed to get it.",
  input: Schema.Struct(OneBroadcast),
  output: Broadcast,
  errors: [
    BroadcastNotFound,
    BroadcastNotDraft,
    BroadcastIncomplete,
    SegmentNotFound,
    SegmentHasNoRecipients,
    SenderNotReady,
  ],
  http: { method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/send" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:send"],
})

export const cancelBroadcast = defineTeamOperation({
  name: "broadcasts.cancel",
  description: "Stop sending a broadcast. Emails already sent stay sent; the rest are recorded as cancelled.",
  input: Schema.Struct(OneBroadcast),
  output: Broadcast,
  errors: [BroadcastNotFound, BroadcastNotSending],
  http: { method: "POST", path: "/teams/:teamId/broadcasts/:broadcastId/cancel" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:send"],
})

export const listBroadcastRecipients = defineTeamOperation({
  name: "broadcasts.recipients",
  description:
    "Who a broadcast went to, and what happened for each: sent, delivered, skipped (and why), failed, bounced, and whether they unsubscribed through it.",
  input: Schema.Struct({
    ...OneBroadcast,
    status: Schema.optional(RecipientStatus),
    unsubscribed: Schema.optional(
      Schema.Boolean.annotate({
        title: "Unsubscribed",
        description: "true: only recipients who unsubscribed through this broadcast's link (D119).",
      }),
    ),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
    cursor: Schema.optional(Schema.String),
  }),
  output: RecipientPage,
  errors: [BroadcastNotFound],
  http: { method: "GET", path: "/teams/:teamId/broadcasts/:broadcastId/recipients" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})
