import { Schema } from "effect"
import { Filter } from "./filter.ts"
import {
  BroadcastId,
  ContactId,
  EmailImageId,
  EmailStyleId,
  SegmentId,
  SendingDomainId,
  TemplateId,
  TopicId,
  UserId,
} from "./ids.ts"

const Timestamp = Schema.String.annotate({ description: "ISO 8601 timestamp" })

/** Whether a contact receives marketing email (R37). Only subscribed contacts are sent broadcasts. */
export const SubscriptionStatus = Schema.Literals(["subscribed", "unsubscribed", "bounced", "marked-as-spam"]).annotate(
  {
    title: "Subscription status",
    description:
      "subscribed, unsubscribed, bounced or marked-as-spam. Only subscribed contacts are sent broadcasts. Bounced and marked-as-spam are set by Parley from the email provider.",
  },
)
export type SubscriptionStatus = typeof SubscriptionStatus.Type

export const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<SubscriptionStatus, string>> = {
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  "marked-as-spam": "Marked as spam",
}

// Topics

export const TopicName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60))
export const TopicDescription = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(200))
export const TopicMode = Schema.Literals(["opt-out", "opt-in"]).annotate({
  title: "Mode",
  description:
    "opt-out: sent to everyone subscribed who hasn't left the topic. opt-in: sent only to contacts who joined it (D149).",
})

/** A kind of marketing email a contact can unsubscribe from on its own (R38). */
export const Topic = Schema.Struct({
  id: TopicId,
  name: Schema.String,
  /** Shown on the unsubscribe page. */
  description: Schema.NullOr(Schema.String),
  /**
   * opt-out: sent to everyone subscribed who hasn't left it. opt-in: sent only to contacts who
   * joined it, through a form, an import or by hand (D149).
   */
  mode: Schema.Literals(["opt-out", "opt-in"]),
  /** Contacts unsubscribed from this topic alone (opt-out topics). */
  unsubscribedCount: Schema.Number,
  /** Contacts who joined it (opt-in topics). */
  memberCount: Schema.Number,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Topic = typeof Topic.Type

/** A contact's subscriptions: their status, and the topics they've left. */
export const ContactSubscriptions = Schema.Struct({
  contactId: ContactId,
  status: SubscriptionStatus,
  topics: Schema.Array(Schema.Struct({ topicId: TopicId, name: Schema.String, subscribed: Schema.Boolean })),
})
export type ContactSubscriptions = typeof ContactSubscriptions.Type

// Sender, footer and sending domains

export const DnsRecord = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  value: Schema.String,
  priority: Schema.NullOr(Schema.Number),
  /** Whether the provider has seen this record yet. */
  status: Schema.Literals(["pending", "verified", "failed"]),
})
export type DnsRecord = typeof DnsRecord.Type

/** A domain the team sends from (R44). */
export const SendingDomain = Schema.Struct({
  id: SendingDomainId,
  domain: Schema.String,
  status: Schema.Literals(["pending", "verified", "failed"]),
  /** The DNS records to add at the domain's DNS host. */
  records: Schema.Array(DnsRecord),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type SendingDomain = typeof SendingDomain.Type

/** The team's sender and footer (R40). Every field is needed before anything can be sent. */
export const EmailSettings = Schema.Struct({
  senderName: Schema.NullOr(Schema.String),
  senderAddress: Schema.NullOr(Schema.String),
  replyTo: Schema.NullOr(Schema.String),
  legalName: Schema.NullOr(Schema.String),
  postalAddress: Schema.NullOr(Schema.String),
  footerReason: Schema.NullOr(Schema.String),
  /** What's still missing before the team can send; empty when ready. */
  missing: Schema.Array(
    Schema.Literals([
      "sender-name",
      "sender-address",
      "verified-domain",
      "legal-name",
      "postal-address",
      "footer-reason",
    ]),
  ),
})
export type EmailSettings = typeof EmailSettings.Type

export const SenderName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
export const LegalName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(160))
export const SenderPostalAddress = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(300),
)
export const FooterReason = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(300))

// Segments

export const SegmentName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))

/** A segment's optional description (D141). */
export const SegmentDescription = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(500)).annotate({
  title: "Description",
  description: "What the segment is for, in a sentence or two. Empty or null clears it.",
})

/** A group of contacts a broadcast is sent to (D23). */
export const Segment = Schema.Struct({
  id: SegmentId,
  name: Schema.String,
  /** What the segment is for, in a sentence or two (D141), or null. */
  description: Schema.NullOr(Schema.String),
  /** dynamic: defined by a filter over contacts; fixed: hand-picked contacts. */
  kind: Schema.Literals(["dynamic", "fixed"]),
  /** A dynamic segment's filter, the same as contacts.list takes. Null for a fixed segment. */
  filter: Schema.NullOr(Filter),
  /** Live contacts in the segment now, whatever their subscription status. */
  contactCount: Schema.Number,
  /** Of those, the ones a broadcast would be sent to: subscribed, with an email address. */
  sendableCount: Schema.Number,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Segment = typeof Segment.Type

// Templates and broadcasts

export const ContentName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(120))
export const Subject = Schema.String.check(Schema.isMaxLength(200)).annotate({
  title: "Subject",
  description: "The subject line. Merge tags like {{first_name|there}} work here.",
})
export const PreviewText = Schema.String.check(Schema.isMaxLength(200)).annotate({
  title: "Preview text",
  description: "The line inbox apps show after the subject.",
})
export const Body = Schema.String.check(Schema.isMaxLength(100_000)).annotate({
  title: "Body",
  description:
    "Markdown. Merge tags: {{first_name}}, {{last_name}}, {{name}}, {{email}}, {{company}}, each with an optional fallback, like {{first_name|there}}. HTML is shown as typed, not rendered. Parley adds the footer.",
})

/** Reusable content a broadcast starts from (R41). */
export const Template = Schema.Struct({
  id: TemplateId,
  name: Schema.String,
  subject: Schema.String,
  previewText: Schema.String,
  body: Schema.String,
  /** The email style it uses; null means the team's default (D117). */
  styleId: Schema.NullOr(EmailStyleId),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Template = typeof Template.Type

export const BroadcastStatus = Schema.Literals(["draft", "sending", "sent", "canceled"])
export type BroadcastStatus = typeof BroadcastStatus.Type

/** How a broadcast's sending went, by recipient. */
export const BroadcastCounts = Schema.Struct({
  recipients: Schema.Number,
  queued: Schema.Number,
  sent: Schema.Number,
  delivered: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
  bounced: Schema.Number,
  markedAsSpam: Schema.Number,
  canceled: Schema.Number,
  /** Recipients who unsubscribed through this broadcast's link, from everything or from its topic (D119). */
  unsubscribed: Schema.Number,
})
export type BroadcastCounts = typeof BroadcastCounts.Type

/** One marketing email (R42). */
export const Broadcast = Schema.Struct({
  id: BroadcastId,
  name: Schema.String,
  subject: Schema.String,
  previewText: Schema.String,
  body: Schema.String,
  status: BroadcastStatus,
  /** The email style it uses; null means the team's default (D117). A sent broadcast keeps the look it was sent with. */
  styleId: Schema.NullOr(EmailStyleId),
  segmentId: Schema.NullOr(SegmentId),
  /** The segment's name, as it was when sent for a sent broadcast. */
  segmentName: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(TopicId),
  topicName: Schema.NullOr(Schema.String),
  sentByUserId: Schema.NullOr(UserId),
  sentByName: Schema.NullOr(Schema.String),
  sendingStartedAt: Schema.NullOr(Timestamp),
  finishedAt: Schema.NullOr(Timestamp),
  /** Null for a draft. */
  counts: Schema.NullOr(BroadcastCounts),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Broadcast = typeof Broadcast.Type

export const RecipientStatus = Schema.Literals([
  "queued",
  "sent",
  "delivered",
  "skipped",
  "failed",
  "bounced",
  "marked-as-spam",
  "canceled",
])
export type RecipientStatus = typeof RecipientStatus.Type

export const SkipReason = Schema.Literals([
  "no-email",
  "unsubscribed",
  "unsubscribed-from-topic",
  "bounced",
  "marked-as-spam",
])
export type SkipReason = typeof SkipReason.Type

/** A contact a broadcast was sent to, and what happened. */
export const Recipient = Schema.Struct({
  contactId: Schema.NullOr(ContactId),
  name: Schema.String,
  address: Schema.NullOr(Schema.String),
  status: RecipientStatus,
  skipReason: Schema.NullOr(SkipReason),
  /** Why sending failed, in our words. */
  error: Schema.NullOr(Schema.String),
  sentAt: Schema.NullOr(Timestamp),
  /** Whether they unsubscribed through this broadcast's link: from everything, or from its topic (D119). */
  unsubscribed: Schema.NullOr(Schema.Literals(["everything", "topic"])),
})
export type Recipient = typeof Recipient.Type

export const RecipientPage = Schema.Struct({
  items: Schema.Array(Recipient),
  nextCursor: Schema.NullOr(Schema.String),
})

/** A rendered email, as a recipient would get it. */
export const RenderedEmail = Schema.Struct({
  subject: Schema.String,
  previewText: Schema.String,
  html: Schema.String,
  text: Schema.String,
  /** Merge tags used that Parley doesn't know, so they'd be sent as typed. */
  unknownMergeTags: Schema.Array(Schema.String),
})
export type RenderedEmail = typeof RenderedEmail.Type

export const TestRecipients = Schema.Array(UserId).check(Schema.isMinLength(1), Schema.isMaxLength(5))

/** What the public unsubscribe page shows a recipient (R39). Not an operation: recipients don't sign in. */
export const UnsubscribePage = Schema.Struct({
  /** The sender's legal name, else the team's name. */
  senderName: Schema.String,
  /** The address the email went to, partly hidden ("s***@acme.com"). */
  address: Schema.NullOr(Schema.String),
  status: SubscriptionStatus,
  /** The topic of the broadcast the link came from, if it had one. */
  topicId: Schema.NullOr(TopicId),
  topics: Schema.Array(
    Schema.Struct({
      id: TopicId,
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
      subscribed: Schema.Boolean,
    }),
  ),
  /** A link from a test send: changes are shown but not saved. */
  test: Schema.Boolean,
})
export type UnsubscribePage = typeof UnsubscribePage.Type

/** A change made on the unsubscribe page. "one-click" is RFC 8058's POST. */
export const UnsubscribeChange = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("one-click") }),
  Schema.Struct({ kind: Schema.Literal("all"), subscribed: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("topic"), topicId: TopicId, subscribed: Schema.Boolean }),
])
export type UnsubscribeChange = typeof UnsubscribeChange.Type

// Email styles (D116) and images (D120)

export const EmailStyleName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(80))
export const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)).annotate({
  title: "Color",
  description: "A hex color like #1F2430.",
})
export const EmailStyleLayout = Schema.Literals(["plain", "card", "custom"]).annotate({
  title: "Layout",
  description:
    "plain: like a personal email. card: the content on a white card over the background color. custom: your own HTML (customHtml) around the content.",
})
export type EmailStyleLayout = typeof EmailStyleLayout.Type
export const EmailFont = Schema.Literals(["sans", "serif", "default"]).annotate({
  title: "Font",
  description: "sans (Helvetica, Arial), serif (Georgia, Times), or default: the reader's own font.",
})
export type EmailFont = typeof EmailFont.Type
export const EmailStyleColors = Schema.Struct({
  text: HexColor,
  background: HexColor,
  link: HexColor,
  button: HexColor,
  buttonText: HexColor,
})
export type EmailStyleColors = typeof EmailStyleColors.Type
export const HeaderText = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(120))
export const CustomHtml = Schema.String.check(Schema.isMaxLength(100_000)).annotate({
  title: "Custom HTML",
  description:
    "Your own HTML around the content, for layout custom. It must contain {{content}} where the email's body goes. Scripts, forms and iframes are removed, and Parley's footer is always added after it.",
})

/** A reusable look for emails (D116): logo and header, colors, font, plain or card, or custom HTML. */
export const EmailStyle = Schema.Struct({
  id: EmailStyleId,
  name: Schema.String,
  /** The team's default: templates and broadcasts without a style of their own use it. Exactly one per team. */
  isDefault: Schema.Boolean,
  layout: EmailStyleLayout,
  /** The logo's public address, or null for none. */
  logoUrl: Schema.NullOr(Schema.String),
  logoAlign: Schema.Literals(["left", "center"]),
  headerText: Schema.NullOr(Schema.String),
  /** Where the footer's lines sit, inside the same column or card as the content. */
  footerAlign: Schema.Literals(["left", "center", "right"]),
  colors: EmailStyleColors,
  font: EmailFont,
  customHtml: Schema.NullOr(Schema.String),
  /** How many templates and draft broadcasts name this style. A style in use can't be deleted. */
  usedBy: Schema.Struct({ templates: Schema.Number, broadcasts: Schema.Number }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type EmailStyle = typeof EmailStyle.Type

/** The plain look's colors (D115): what a new style starts with. */
export const PLAIN_COLORS: EmailStyleColors = {
  text: "#1A1A1A",
  background: "#FFFFFF",
  link: "#1A0DAB",
  button: "#1A1A1A",
  buttonText: "#FFFFFF",
}

/** An image hosted by Parley for use in emails (D120). Public, at an unguessable address. */
export const EmailImage = Schema.Struct({
  id: EmailImageId,
  /** The absolute public address to put in an email, e.g. in Markdown ![description](url). */
  url: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  createdAt: Timestamp,
})
export type EmailImage = typeof EmailImage.Type
