import { sql } from "drizzle-orm"
import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { organization, user } from "./auth.ts"

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}

/** Every tenant table carries team_id, so row-level security can be added later without a migration (D28). */
const teamId = () =>
  text("team_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" })

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Custom field values by field id (D31). */
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    /** The uploaded avatar's file key (D75). */
    avatarKey: text("avatar_key"),
    /** Whether the contact receives marketing email (R37). */
    subscriptionStatus: text("subscription_status", {
      enum: ["subscribed", "unsubscribed", "bounced", "marked-as-spam"],
    })
      .notNull()
      .default("subscribed"),
    /** Where the contact is (D128), as a company's address. Country is an ISO 3166-1 alpha-2 code. */
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postcode: text("postcode"),
    country: text("country"),
    /** Links to their profiles on social networks (D133). */
    socialProfiles: text("social_profiles").array().notNull().default(sql`'{}'::text[]`),
    /** The record owner (D123): a member responsible for it. Cleared when they leave the team. */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
    /** Soft delete: hidden at once, restorable for 30 days, then purged (D30). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("contacts_team_id_id_key").on(t.teamId, t.id),
    index("contacts_team_id_updated_at_idx").on(t.teamId, t.updatedAt.desc(), t.id.desc()),
    index("contacts_team_owner_idx").on(t.teamId, t.ownerId),
  ],
)

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    contactId: uuid("contact_id").notNull(),
    /** Stored lower-cased. */
    address: text("address").notNull(),
    isPrimary: boolean("is_primary").notNull(),
    position: integer("position").notNull(),
    /** False while the contact is deleted, which releases the address (D30). */
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: "contact_emails_contact_fk",
      columns: [t.teamId, t.contactId],
      foreignColumns: [contacts.teamId, contacts.id],
    }).onDelete("cascade"),
    uniqueIndex("contact_emails_team_id_address_key").on(t.teamId, t.address).where(sql`active`),
    index("contact_emails_contact_id_idx").on(t.contactId),
  ],
)

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    contactId: uuid("contact_id").notNull(),
    /** E.164 (D34). */
    number: text("number").notNull(),
    label: text("label"),
    position: integer("position").notNull(),
  },
  (t) => [
    foreignKey({
      name: "contact_phones_contact_fk",
      columns: [t.teamId, t.contactId],
      foreignColumns: [contacts.teamId, contacts.id],
    }).onDelete("cascade"),
    index("contact_phones_contact_id_idx").on(t.contactId),
  ],
)

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    recordType: text("record_type", { enum: ["contact", "company"] }).notNull(),
    recordId: uuid("record_id").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The name shown at the time, kept if the user is later removed. */
    actorName: text("actor_name").notNull(),
    viaApiKeyId: text("via_api_key_id"),
    viaConnectionId: uuid("via_connection_id"),
    /** The API key's or connection's name at the time ("Claude on my laptop", D78). */
    viaName: text("via_name"),
    kind: text("kind", {
      enum: [
        "created",
        "updated",
        "deleted",
        "restored",
        "affiliated",
        "unaffiliated",
        "emailed",
        "unsubscribed",
        "resubscribed",
        "bounced",
        "marked-as-spam",
        "submitted-form",
      ],
    }).notNull(),
    changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
    /** For "submitted-form": values not written because the contact had one (D145), for a person to apply. */
    kept: jsonb("kept").$type<ReadonlyArray<{ field: string; label: string; value: unknown }>>().notNull().default([]),
    /** For "submitted-form": the page and tracking parameters the submission recorded (D153). */
    tracking: jsonb("tracking").$type<{
      page: string | null
      utm: Record<string, string>
      clickIds: Record<string, string>
    }>(),
    /** The other record an affiliation change was about, and its name at the time. */
    relatedRecordType: text("related_record_type", { enum: ["contact", "company", "broadcast", "form"] }),
    relatedRecordId: uuid("related_record_id"),
    relatedName: text("related_name"),
    /** Set when Parley made the change itself (D105). */
    reason: text("reason", { enum: ["domain-matching"] }),
    /** For domain matching, the domain that matched (D111). */
    matchedDomain: text("matched_domain"),
    /** For an unsubscribe or resubscribe from one topic, the topic's name at the time (R38). */
    topicName: text("topic_name"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("activity_record_idx").on(t.teamId, t.recordId, t.at)],
)

/**
 * An agent someone authorized over OAuth (D92). Bound to one team, acting as the person who
 * connected it or as a service account, limited to its scopes. Access tokens carry only its id,
 * so revoking it takes effect on the next request.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    /** The OAuth client (the agent's registration). */
    clientId: text("client_id").notNull(),
    /** The client's own name at the time of consent ("Claude", "Cursor"). */
    name: text("name").notNull(),
    connectedByUserId: text("connected_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The connecting user, or a service account (D94). */
    actsAsUserId: text("acts_as_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    /** The sign-in session that gave consent. Links the consent to this row until the first token is issued. */
    sessionId: text("session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Set when the first access token is issued. Until then the connection is pending. */
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("connections_team_id_idx").on(t.teamId, t.createdAt.desc()),
    index("connections_session_id_idx").on(t.sessionId).where(sql`authorized_at is null`),
  ],
)

/** Parley's own facts about a service account (the account itself is a Better-Auth user of kind "service-account"). */
export const serviceAccounts = pgTable("service_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  teamId: teamId(),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
})

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    name: text("name").notNull(),
    website: text("website"),
    phone: text("phone"),
    /** The postal address (D104). Country is an ISO 3166-1 alpha-2 code. */
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postcode: text("postcode"),
    country: text("country"),
    /** What the company does (D132). */
    description: text("description"),
    employees: integer("employees"),
    industry: text("industry"),
    yearFounded: integer("year_founded"),
    /** In the team's currency (D132). */
    annualRevenue: doublePrecision("annual_revenue"),
    /** Links to its pages on social networks (D133). */
    socialProfiles: text("social_profiles").array().notNull().default(sql`'{}'::text[]`),
    /** Custom field values by field id (D31). */
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    /** The logo's file key, and where it came from: an upload wins over the fetched favicon (D75). */
    logoKey: text("logo_key"),
    logoSource: text("logo_source", { enum: ["upload", "favicon"] }),
    /** The record owner (D123): a member responsible for it. Cleared when they leave the team. */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
    /** Soft delete, like contacts (D30, D109). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("companies_team_id_id_key").on(t.teamId, t.id),
    index("companies_team_id_updated_at_idx").on(t.teamId, t.updatedAt.desc(), t.id.desc()),
    index("companies_team_owner_idx").on(t.teamId, t.ownerId),
  ],
)

export const companyDomains = pgTable(
  "company_domains",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    companyId: uuid("company_id").notNull(),
    /** Lower-case, without "www." (D25). */
    domain: text("domain").notNull(),
    isPrimary: boolean("is_primary").notNull(),
    position: integer("position").notNull(),
    /** False while the company is deleted, which releases the domain (D30). */
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: "company_domains_company_fk",
      columns: [t.teamId, t.companyId],
      foreignColumns: [companies.teamId, companies.id],
    }).onDelete("cascade"),
    uniqueIndex("company_domains_team_id_domain_key").on(t.teamId, t.domain).where(sql`active`),
    index("company_domains_company_id_idx").on(t.companyId),
  ],
)

/** A contact's link to a company (D29). Hidden while either side is deleted (D109). */
export const affiliations = pgTable(
  "affiliations",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    contactId: uuid("contact_id").notNull(),
    companyId: uuid("company_id").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: "affiliations_contact_fk",
      columns: [t.teamId, t.contactId],
      foreignColumns: [contacts.teamId, contacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "affiliations_company_fk",
      columns: [t.teamId, t.companyId],
      foreignColumns: [companies.teamId, companies.id],
    }).onDelete("cascade"),
    unique("affiliations_contact_id_company_id_key").on(t.contactId, t.companyId),
    index("affiliations_company_id_idx").on(t.companyId),
  ],
)

/** A note on a contact or company, shown in its activity (D74). */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    recordType: text("record_type", { enum: ["contact", "company"] }).notNull(),
    recordId: uuid("record_id").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The name shown at the time, kept if the author is later removed. */
    authorName: text("author_name").notNull(),
    viaApiKeyId: text("via_api_key_id"),
    viaConnectionId: uuid("via_connection_id"),
    viaName: text("via_name"),
    ...timestamps,
  },
  (t) => [index("notes_record_idx").on(t.teamId, t.recordId, t.createdAt)],
)

/** A team's custom field on contacts or companies (D31, D68). Values live on the records. */
export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    recordType: text("record_type", { enum: ["contact", "company"] }).notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    options: jsonb("options").$type<Array<{ id: string; label: string }>>().notNull().default([]),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("custom_fields_team_id_record_type_name_key").on(t.teamId, t.recordType, sql`lower(${t.name})`),
    index("custom_fields_team_id_idx").on(t.teamId, t.recordType, t.position),
  ],
)

/** Parley's own settings for a team (the team itself is a Better-Auth organization). */
export const teamSettings = pgTable("team_settings", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** Show contacts' Gravatar pictures (D77). Off by default. */
  gravatar: boolean("gravatar").notNull().default(false),
})

/** A named filter, sort and columns for an index view, personal or shared (D59, D60). */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    recordType: text("record_type", { enum: ["contact", "company"] }).notNull(),
    name: text("name").notNull(),
    shared: boolean("shared").notNull().default(false),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    ownerName: text("owner_name").notNull(),
    filter: jsonb("filter").$type<unknown>().notNull(),
    sort: jsonb("sort").$type<unknown>(),
    columns: jsonb("columns").$type<Array<string>>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("saved_views_team_id_idx").on(t.teamId, t.recordType)],
)

/**
 * Files kept in Postgres when no S3-compatible store is configured (D76). Small, resized images only;
 * the content is base64 so it travels safely through every driver.
 */
export const files = pgTable("files", {
  key: text("key").primaryKey(),
  teamId: teamId(),
  contentType: text("content_type").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

/** A team's sender and footer (R40). One row per team, made on first save. */
export const emailSettings = pgTable("email_settings", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  senderName: text("sender_name"),
  /** The full address, on one of the team's sending domains. */
  senderAddress: text("sender_address"),
  replyTo: text("reply_to"),
  legalName: text("legal_name"),
  postalAddress: text("postal_address"),
  /** Why recipients get the email ("You're getting this because you signed up at acme.com."). */
  footerReason: text("footer_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

/** A domain a team sends from, registered with the email provider (R44). Unique across teams. */
export const sendingDomains = pgTable(
  "sending_domains",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    domain: text("domain").notNull(),
    providerId: text("provider_id"),
    status: text("status", { enum: ["pending", "verified", "failed"] }).notNull(),
    /** The DNS records to add, as the provider gave them. */
    records: jsonb("records").$type<Array<unknown>>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("sending_domains_domain_key").on(t.domain), index("sending_domains_team_idx").on(t.teamId)],
)

/** A kind of marketing email a contact can unsubscribe from on its own (R38). */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    name: text("name").notNull(),
    description: text("description"),
    /** opt-out: everyone subscribed who hasn't left. opt-in: only its members (D149). */
    mode: text("mode", { enum: ["opt-out", "opt-in"] })
      .notNull()
      .default("opt-out"),
    ...timestamps,
  },
  (t) => [index("topics_team_idx").on(t.teamId)],
)

/** A contact who joined an opt-in topic (D149), and how. */
export const topicMembers = pgTable(
  "topic_members",
  {
    teamId: teamId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    /** The confirmed submission that joined them, or null when added by hand or import. */
    submissionId: uuid("submission_id"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("topic_members_key").on(t.contactId, t.topicId), index("topic_members_topic_idx").on(t.topicId)],
)

/** A contact unsubscribed from one topic. */
export const topicUnsubscribes = pgTable(
  "topic_unsubscribes",
  {
    teamId: teamId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("topic_unsubscribes_key").on(t.contactId, t.topicId)],
)

/** A group of contacts a broadcast is sent to (D23): by filter, or hand-picked. */
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    name: text("name").notNull(),
    /** What the segment is for (D141), or null. */
    description: text("description"),
    kind: text("kind", { enum: ["dynamic", "fixed"] }).notNull(),
    /** A dynamic segment's filter over contacts (D59). Null for a fixed segment. */
    filter: jsonb("filter").$type<unknown>(),
    ...timestamps,
  },
  (t) => [index("segments_team_idx").on(t.teamId)],
)

/** The contacts of a fixed segment. */
export const segmentContacts = pgTable(
  "segment_contacts",
  {
    teamId: teamId(),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("segment_contacts_key").on(t.segmentId, t.contactId),
    index("segment_contacts_contact_idx").on(t.contactId),
  ],
)

/** A reusable look for emails (D116). Every team has at least one, and exactly one is its default. */
export const emailStyles = pgTable(
  "email_styles",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    layout: text("layout", { enum: ["plain", "card", "custom"] })
      .notNull()
      .default("plain"),
    /** The logo's file key (an email image), or null for none. */
    logoKey: text("logo_key"),
    logoAlign: text("logo_align", { enum: ["left", "center"] })
      .notNull()
      .default("left"),
    headerText: text("header_text"),
    footerAlign: text("footer_align", { enum: ["left", "center", "right"] })
      .notNull()
      .default("left"),
    colors: jsonb("colors")
      .$type<{ text: string; background: string; link: string; button: string; buttonText: string }>()
      .notNull(),
    font: text("font", { enum: ["sans", "serif", "default"] })
      .notNull()
      .default("default"),
    customHtml: text("custom_html"),
    ...timestamps,
  },
  (t) => [
    index("email_styles_team_idx").on(t.teamId),
    // At most one default per team; the service keeps it at exactly one.
    uniqueIndex("email_styles_default_key").on(t.teamId).where(sql`${t.isDefault}`),
  ],
)

/** An image hosted for emails (D120): served publicly at /i/<id>, an unguessable id. */
export const emailImages = pgTable(
  "email_images",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    /** Where the bytes are, in the file store. */
    fileKey: text("file_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** The address it was copied from, for emailImages.import. */
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("email_images_team_idx").on(t.teamId)],
)

/** Reusable content a broadcast starts from (R41). */
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    name: text("name").notNull(),
    subject: text("subject").notNull().default(""),
    previewText: text("preview_text").notNull().default(""),
    body: text("body").notNull().default(""),
    /** Null uses the team's default style (D117). */
    styleId: uuid("style_id").references(() => emailStyles.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("templates_team_idx").on(t.teamId)],
)

/** One marketing email (R42). A draft until sent; sent ones keep their sender and footer as sent. */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    name: text("name").notNull(),
    subject: text("subject").notNull().default(""),
    previewText: text("preview_text").notNull().default(""),
    body: text("body").notNull().default(""),
    /** Null uses the team's default style (D117). A sent broadcast's look is in sent_as. */
    styleId: uuid("style_id").references(() => emailStyles.id, { onDelete: "set null" }),
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    status: text("status", { enum: ["draft", "sending", "sent", "cancelled"] })
      .notNull()
      .default("draft"),
    /** Copied when sending starts, so later settings changes don't alter a broadcast in flight. */
    sentAs: jsonb("sent_as").$type<unknown>(),
    segmentName: text("segment_name"),
    topicName: text("topic_name"),
    sentByUserId: text("sent_by_user_id").references(() => user.id, { onDelete: "set null" }),
    sentByName: text("sent_by_name"),
    sendingStartedAt: timestamp("sending_started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("broadcasts_team_idx").on(t.teamId, t.updatedAt)],
)

/** A contact a broadcast is sent to, and what happened (R42, R46). */
export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** Kept as sent, in case the contact changes or is purged. */
    address: text("address"),
    name: text("name").notNull(),
    /** Merge tag values, taken when the broadcast was queued. */
    merge: jsonb("merge").$type<Record<string, string>>().notNull().default({}),
    status: text("status", {
      enum: ["queued", "sent", "delivered", "skipped", "failed", "bounced", "marked-as-spam", "cancelled"],
    }).notNull(),
    skipReason: text("skip_reason", {
      enum: ["no-email", "unsubscribed", "unsubscribed-from-topic", "bounced", "marked-as-spam"],
    }),
    providerId: text("provider_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("broadcast_recipients_key").on(t.broadcastId, t.contactId),
    index("broadcast_recipients_queue_idx").on(t.status, t.teamId, t.createdAt),
    index("broadcast_recipients_provider_idx").on(t.providerId),
  ],
)

/**
 * An import of contacts or companies, run in the background (D135). Its file is split into
 * import_parts when it starts; the runner imports one part at a time and deletes it once imported,
 * so a restart picks up at the next part. `failed` and `warnings` keep the first 1,000 rows of each.
 */
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey(),
    teamId: teamId(),
    recordType: text("record_type", { enum: ["contact", "company"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "fetching-logos", "finished", "cancelled", "failed"] })
      .notNull()
      .default("queued"),
    fileName: text("file_name"),
    /** mapping, set, owners and multiSelect, as given to imports.start. */
    options: jsonb("options").$type<unknown>().notNull(),
    totalRows: integer("total_rows").notNull(),
    processedRows: integer("processed_rows").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    failed: jsonb("failed").$type<unknown[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
    /** Null for contacts, and for companies before their logos are counted. */
    logosTotal: integer("logos_total"),
    logosDone: integer("logos_done").notNull().default(0),
    startedByUserId: text("started_by_user_id").references(() => user.id, { onDelete: "set null" }),
    startedByName: text("started_by_name"),
    /** Who started it, as authenticated: each part is imported as them, with their access checked again. */
    principal: jsonb("principal").$type<unknown>().notNull(),
    /** Why it stopped, when its status is "failed": a message for the person, in our words. */
    error: text("error"),
    /** When a runner last claimed it; a claim older than a few minutes is taken over (a restart). */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("imports_team_idx").on(t.teamId, t.createdAt), index("imports_status_idx").on(t.status)],
)

/** A slice of an import's file, with the header row, imported in one go (D135). Deleted once imported. */
export const importParts = pgTable(
  "import_parts",
  {
    id: uuid("id").primaryKey(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** The file line of the part's first row (the header is line 1). */
    firstLine: integer("first_line").notNull(),
    csv: text("csv").notNull(),
  },
  (t) => [uniqueIndex("import_parts_position_idx").on(t.importId, t.position)],
)

/** A company logo to fetch after an import's rows are in, one at a time (D135). Deleted once fetched. */
export const importLogos = pgTable(
  "import_logos",
  {
    id: uuid("id").primaryKey(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** The file line it came from, for a warning if it can't be fetched. */
    line: integer("line").notNull(),
    url: text("url").notNull(),
  },
  (t) => [index("import_logos_import_idx").on(t.importId, t.line)],
)
