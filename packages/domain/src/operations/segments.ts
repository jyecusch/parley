import { Schema } from "effect"
import { ContactPage } from "../contact.ts"
import { Segment, SegmentName } from "../email.ts"
import { SegmentIsDynamic, SegmentLimitReached, SegmentNotFound } from "../errors/campaigns.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { Filter } from "../filter.ts"
import { ContactId, SegmentId, TeamId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneSegment = {
  ...InTeam,
  segmentId: SegmentId.annotate({ description: "The segment's id, from segments.list." }),
}
const ContactIds = Schema.Array(ContactId)
  .check(Schema.isMinLength(1), Schema.isMaxLength(1000))
  .annotate({ title: "Contacts", description: "Contact ids, up to 1,000 at a time." })

export const listSegments = defineTeamOperation({
  name: "segments.list",
  description:
    "List the team's segments: groups of contacts a campaign is sent to. Dynamic segments follow a filter; fixed ones are hand-picked. Counts are as of now.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Segment),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/segments" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const getSegment = defineTeamOperation({
  name: "segments.get",
  description: "One segment, with how many contacts it has now and how many a campaign would go to.",
  input: Schema.Struct(OneSegment),
  output: Segment,
  errors: [SegmentNotFound],
  http: { method: "GET", path: "/teams/:teamId/segments/:segmentId" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createSegment = defineTeamOperation({
  name: "segments.create",
  description:
    "Create a segment. A dynamic segment takes a filter over contacts, the same as contacts.list; its contacts change as records change. A fixed segment starts empty: add contacts with segments.addContacts.",
  input: Schema.Struct({
    ...InTeam,
    name: SegmentName.annotate({ title: "Name" }),
    kind: Schema.Literals(["dynamic", "fixed"]).annotate({ title: "Kind" }),
    filter: Schema.optional(Filter),
  }),
  output: Segment,
  errors: [SegmentLimitReached],
  http: { method: "POST", path: "/teams/:teamId/segments" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const updateSegment = defineTeamOperation({
  name: "segments.update",
  description: "Rename a segment, or change a dynamic segment's filter. A segment's kind can't change.",
  input: Schema.Struct({
    ...OneSegment,
    name: Schema.optional(SegmentName.annotate({ title: "Name" })),
    filter: Schema.optional(Filter),
  }),
  output: Segment,
  errors: [SegmentNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/segments/:segmentId" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const deleteSegment = defineTeamOperation({
  name: "segments.delete",
  description:
    "Delete a segment. Draft campaigns that used it need another; sent campaigns keep its name in their history. Its contacts are untouched.",
  input: Schema.Struct(OneSegment),
  output: Segment,
  errors: [SegmentNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/segments/:segmentId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["records:read", "email:write"],
})

export const listSegmentContacts = defineTeamOperation({
  name: "segments.contacts",
  description: "The contacts in a segment now, most recently updated first, a page at a time.",
  input: Schema.Struct({
    ...OneSegment,
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
    cursor: Schema.optional(Schema.String),
  }),
  output: ContactPage,
  errors: [SegmentNotFound],
  http: { method: "GET", path: "/teams/:teamId/segments/:segmentId/contacts" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const addSegmentContacts = defineTeamOperation({
  name: "segments.addContacts",
  description: "Add contacts to a fixed segment. Contacts already in it are left as they are.",
  input: Schema.Struct({ ...OneSegment, contactIds: ContactIds }),
  output: Segment,
  errors: [SegmentNotFound, SegmentIsDynamic, ContactNotFound],
  http: { method: "POST", path: "/teams/:teamId/segments/:segmentId/contacts" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "email:write"],
})

export const removeSegmentContacts = defineTeamOperation({
  name: "segments.removeContacts",
  description: "Take contacts out of a fixed segment. The contacts themselves are untouched.",
  input: Schema.Struct({ ...OneSegment, contactIds: ContactIds }),
  output: Segment,
  errors: [SegmentNotFound, SegmentIsDynamic],
  http: { method: "POST", path: "/teams/:teamId/segments/:segmentId/contacts/remove" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["records:read", "email:write"],
})
