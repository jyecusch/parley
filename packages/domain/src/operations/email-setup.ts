import { Schema } from "effect"
import { Domain } from "../company.ts"
import { EmailAddress } from "../contact-values.ts"
import {
  ContactSubscriptions,
  LegalName,
  Sender,
  SenderName,
  SenderPostalAddress,
  SendingDomain,
  Topic,
  TopicDescription,
  TopicMode,
  TopicName,
} from "../email.ts"
import {
  SenderAddressNotOnSendingDomain,
  SenderIsDefault,
  SenderNotFound,
  SendingDomainLimitReached,
  SendingDomainNotFound,
  SendingDomainTaken,
  TopicNotFound,
} from "../errors/broadcasts.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { EmailErrors } from "../errors/email.ts"
import { ContactId, SenderId, SendingDomainId, TeamId, TopicId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneTopic = { ...InTeam, topicId: TopicId.annotate({ description: "The topic's id, from topics.list." }) }
const OneDomain = {
  ...InTeam,
  sendingDomainId: SendingDomainId.annotate({ description: "The sending domain's id, from sendingDomains.list." }),
}
const OneSender = { ...InTeam, senderId: SenderId.annotate({ description: "The sender's id, from senders.list." }) }
const OneContact = { ...InTeam, contactId: ContactId.annotate({ description: "The contact's id." }) }

export const listSenders = defineTeamOperation({
  name: "senders.list",
  description:
    "List who the team's email can come from: each sender's name and address on a sending domain, reply-to, and the legal name and postal address its footer shows. One is the default, used by broadcasts and forms that don't pick a sender. A sender is ready when its domain is verified.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Sender),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/senders" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["email:write"],
})

const SenderFields = {
  name: SenderName.annotate({ title: "Sender name", description: "What people see in their inbox." }),
  address: EmailAddress.annotate({
    title: "Sender address",
    description: "On one of the team's sending domains, from sendingDomains.list.",
  }),
  replyTo: Schema.NullOr(
    EmailAddress.annotate({ title: "Reply-to address", description: "Null sends replies to the sender address." }),
  ),
  legalName: LegalName.annotate({ title: "Legal name" }),
  postalAddress: SenderPostalAddress.annotate({ title: "Postal address" }),
}

export const createSender = defineTeamOperation({
  name: "senders.create",
  description:
    "Add a sender. Anti-spam laws need the legal name and postal address, which every email from it ends with. The team's first sender becomes its default; isDefault makes a later one the default.",
  input: Schema.Struct({
    ...InTeam,
    ...SenderFields,
    replyTo: Schema.optional(SenderFields.replyTo),
    isDefault: Schema.optional(Schema.Boolean),
  }),
  output: Sender,
  errors: [SenderAddressNotOnSendingDomain],
  http: { method: "POST", path: "/teams/:teamId/senders" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:manage"],
})

export const updateSender = defineTeamOperation({
  name: "senders.update",
  description:
    "Change a sender. Drafts and forms that send from it change with it; broadcasts already sent keep the sender they went out with.",
  input: Schema.Struct({
    ...OneSender,
    name: Schema.optional(SenderFields.name),
    address: Schema.optional(SenderFields.address),
    replyTo: Schema.optional(SenderFields.replyTo),
    legalName: Schema.optional(SenderFields.legalName),
    postalAddress: Schema.optional(SenderFields.postalAddress),
  }),
  output: Sender,
  errors: [SenderNotFound, SenderAddressNotOnSendingDomain],
  http: { method: "PATCH", path: "/teams/:teamId/senders/:senderId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["email:manage"],
})

export const setDefaultSender = defineTeamOperation({
  name: "senders.setDefault",
  description: "Make a sender the team's default: broadcasts and forms that don't pick a sender send from it.",
  input: Schema.Struct(OneSender),
  output: Sender,
  errors: [SenderNotFound],
  http: { method: "POST", path: "/teams/:teamId/senders/:senderId/default" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["email:manage"],
})

export const deleteSender = defineTeamOperation({
  name: "senders.delete",
  description:
    "Delete a sender. Draft broadcasts and forms that sent from it send from the default sender instead; broadcasts already sent keep it. The default sender can't be deleted.",
  input: Schema.Struct(OneSender),
  output: Sender,
  errors: [SenderNotFound, SenderIsDefault],
  http: { method: "DELETE", path: "/teams/:teamId/senders/:senderId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["email:manage"],
})

export const listSendingDomains = defineTeamOperation({
  name: "sendingDomains.list",
  description: "List the domains the team sends email from, with their status and the DNS records to add.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(SendingDomain),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/sending-domains" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["email:write"],
})

export const createSendingDomain = defineTeamOperation({
  name: "sendingDomains.create",
  description:
    "Add a domain to send email from. Returns DNS records to add at the domain's DNS host; then call sendingDomains.verify.",
  input: Schema.Struct({ ...InTeam, domain: Domain.annotate({ title: "Domain" }) }),
  output: SendingDomain,
  errors: [SendingDomainTaken, SendingDomainLimitReached, ...EmailErrors],
  http: { method: "POST", path: "/teams/:teamId/sending-domains" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:manage"],
})

export const verifySendingDomain = defineTeamOperation({
  name: "sendingDomains.verify",
  description: "Check a sending domain's DNS records again. DNS changes can take a while to be seen.",
  input: Schema.Struct(OneDomain),
  output: SendingDomain,
  errors: [SendingDomainNotFound, ...EmailErrors],
  http: { method: "POST", path: "/teams/:teamId/sending-domains/:sendingDomainId/verify" },
  hints: { readOnly: false, destructive: false, idempotent: true },
  permissions: ["email:manage"],
})

export const deleteSendingDomain = defineTeamOperation({
  name: "sendingDomains.delete",
  description: "Stop sending from a domain. Senders on it can't send until it's added and verified again.",
  input: Schema.Struct(OneDomain),
  output: SendingDomain,
  errors: [SendingDomainNotFound, ...EmailErrors],
  http: { method: "DELETE", path: "/teams/:teamId/sending-domains/:sendingDomainId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["email:manage"],
})

export const listTopics = defineTeamOperation({
  name: "topics.list",
  description:
    "List the team's topics: kinds of marketing email a contact can unsubscribe from on its own. A broadcast can have one.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Topic),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/topics" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createTopic = defineTeamOperation({
  name: "topics.create",
  description:
    "Add a topic. Its name and description are shown on the unsubscribe page. Opt-out topics (the default) reach everyone subscribed who hasn't left; opt-in topics reach only their subscribers, the contacts who joined them.",
  input: Schema.Struct({
    ...InTeam,
    name: TopicName.annotate({ title: "Name" }),
    description: Schema.optional(Schema.NullOr(TopicDescription.annotate({ title: "Description" }))),
    mode: Schema.optional(TopicMode),
  }),
  output: Topic,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/topics" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:manage"],
})

export const updateTopic = defineTeamOperation({
  name: "topics.update",
  description: "Rename a topic, change its description, or switch it between opt-out and opt-in.",
  input: Schema.Struct({
    ...OneTopic,
    name: Schema.optional(TopicName.annotate({ title: "Name" })),
    description: Schema.optional(Schema.NullOr(TopicDescription.annotate({ title: "Description" }))),
    mode: Schema.optional(TopicMode),
  }),
  output: Topic,
  errors: [TopicNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/topics/:topicId" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["email:manage"],
})

export const deleteTopic = defineTeamOperation({
  name: "topics.delete",
  description:
    "Delete a topic. Unsubscribes from it are forgotten, and broadcasts that had it no longer do. Contacts unsubscribed from all email stay unsubscribed.",
  input: Schema.Struct(OneTopic),
  output: Topic,
  errors: [TopicNotFound],
  http: { method: "DELETE", path: "/teams/:teamId/topics/:topicId" },
  hints: { readOnly: false, destructive: true, idempotent: false },
  permissions: ["email:manage"],
})

export const getContactSubscriptions = defineTeamOperation({
  name: "contacts.subscriptions",
  description: "A contact's subscription status and, for each topic, whether they still get it.",
  input: Schema.Struct(OneContact),
  output: ContactSubscriptions,
  errors: [ContactNotFound],
  http: { method: "GET", path: "/teams/:teamId/contacts/:contactId/subscriptions" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const updateContactSubscriptions = defineTeamOperation({
  name: "contacts.updateSubscriptions",
  description:
    "Unsubscribe a contact from topics, or subscribe them again. Only subscribe someone who has agreed to get the email. To unsubscribe from all email, set subscriptionStatus with contacts.update.",
  input: Schema.Struct({
    ...OneContact,
    topics: Schema.Array(Schema.Struct({ topicId: TopicId, subscribed: Schema.Boolean })).check(
      Schema.isMaxLength(100),
    ),
  }),
  output: ContactSubscriptions,
  errors: [ContactNotFound, TopicNotFound],
  http: { method: "PATCH", path: "/teams/:teamId/contacts/:contactId/subscriptions" },
  hints: { readOnly: false, destructive: true, idempotent: true },
  permissions: ["records:read", "records:write"],
})
