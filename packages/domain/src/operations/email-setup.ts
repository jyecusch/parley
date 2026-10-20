import { Schema } from "effect"
import { Domain } from "../company.ts"
import { EmailAddress } from "../contact.ts"
import {
  ContactSubscriptions,
  EmailSettings,
  FooterReason,
  LegalName,
  SenderName,
  SenderPostalAddress,
  SendingDomain,
  Topic,
  TopicDescription,
  TopicName,
} from "../email.ts"
import {
  SenderAddressNotOnSendingDomain,
  SendingDomainLimitReached,
  SendingDomainNotFound,
  SendingDomainTaken,
  TopicNotFound,
} from "../errors/campaigns.ts"
import { ContactNotFound } from "../errors/contacts.ts"
import { EmailErrors } from "../errors/email.ts"
import { ContactId, SendingDomainId, TeamId, TopicId } from "../ids.ts"
import { defineTeamOperation } from "../operation.ts"

const InTeam = { teamId: TeamId.annotate({ description: "The team, from teams.list." }) }
const OneTopic = { ...InTeam, topicId: TopicId.annotate({ description: "The topic's id, from topics.list." }) }
const OneDomain = {
  ...InTeam,
  sendingDomainId: SendingDomainId.annotate({ description: "The sending domain's id, from sendingDomains.list." }),
}
const OneContact = { ...InTeam, contactId: ContactId.annotate({ description: "The contact's id." }) }

export const getEmailSettings = defineTeamOperation({
  name: "emailSettings.get",
  description:
    "The team's sender and footer for marketing email, and what's still missing before it can send. Every campaign email ends with the footer.",
  input: Schema.Struct(InTeam),
  output: EmailSettings,
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/email-settings" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["email:write"],
})

export const updateEmailSettings = defineTeamOperation({
  name: "emailSettings.update",
  description:
    "Set the team's sender (name and address on a sending domain), reply-to address and footer (legal name, postal address, and why recipients get the email). Null clears a value.",
  input: Schema.Struct({
    ...InTeam,
    senderName: Schema.optional(Schema.NullOr(SenderName.annotate({ title: "Sender name" }))),
    senderAddress: Schema.optional(Schema.NullOr(EmailAddress.annotate({ title: "Sender address" }))),
    replyTo: Schema.optional(Schema.NullOr(EmailAddress.annotate({ title: "Reply-to address" }))),
    legalName: Schema.optional(Schema.NullOr(LegalName.annotate({ title: "Legal name" }))),
    postalAddress: Schema.optional(Schema.NullOr(SenderPostalAddress.annotate({ title: "Postal address" }))),
    footerReason: Schema.optional(
      Schema.NullOr(
        FooterReason.annotate({
          title: "Why recipients get this",
          description: 'For example "You\'re getting this because you signed up at acme.com."',
        }),
      ),
    ),
  }),
  output: EmailSettings,
  errors: [SenderAddressNotOnSendingDomain],
  http: { method: "PATCH", path: "/teams/:teamId/email-settings" },
  hints: { readOnly: false, destructive: true, idempotent: true },
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
  description: "Stop sending from a domain. A sender address on it stops working until another is set.",
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
    "List the team's topics: kinds of marketing email a contact can unsubscribe from on its own. A campaign can have one.",
  input: Schema.Struct(InTeam),
  output: Schema.Array(Topic),
  errors: [],
  http: { method: "GET", path: "/teams/:teamId/topics" },
  hints: { readOnly: true, destructive: false, idempotent: true },
  permissions: ["records:read"],
})

export const createTopic = defineTeamOperation({
  name: "topics.create",
  description: "Add a topic. Its name and description are shown on the unsubscribe page.",
  input: Schema.Struct({
    ...InTeam,
    name: TopicName.annotate({ title: "Name" }),
    description: Schema.optional(Schema.NullOr(TopicDescription.annotate({ title: "Description" }))),
  }),
  output: Topic,
  errors: [],
  http: { method: "POST", path: "/teams/:teamId/topics" },
  hints: { readOnly: false, destructive: false, idempotent: false },
  permissions: ["email:manage"],
})

export const updateTopic = defineTeamOperation({
  name: "topics.update",
  description: "Rename a topic or change its description.",
  input: Schema.Struct({
    ...OneTopic,
    name: Schema.optional(TopicName.annotate({ title: "Name" })),
    description: Schema.optional(Schema.NullOr(TopicDescription.annotate({ title: "Description" }))),
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
    "Delete a topic. Unsubscribes from it are forgotten, and campaigns that had it no longer do. Contacts unsubscribed from all email stay unsubscribed.",
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
