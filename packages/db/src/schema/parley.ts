import { sql } from "drizzle-orm"
import {
  boolean,
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
    ...timestamps,
    /** Soft delete: hidden at once, restorable for 30 days, then purged (D30). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("contacts_team_id_id_key").on(t.teamId, t.id),
    index("contacts_team_id_updated_at_idx").on(t.teamId, t.updatedAt.desc(), t.id.desc()),
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
      enum: ["created", "updated", "deleted", "restored", "affiliated", "unaffiliated"],
    }).notNull(),
    changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
    /** The other record an affiliation change was about, and its name at the time. */
    relatedRecordType: text("related_record_type", { enum: ["contact", "company"] }),
    relatedRecordId: uuid("related_record_id"),
    relatedName: text("related_name"),
    /** Set when Parley made the change itself (D105). */
    reason: text("reason", { enum: ["domain-matching"] }),
    /** For domain matching, the domain that matched (D111). */
    matchedDomain: text("matched_domain"),
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
    /** Custom field values by field id (D31). */
    custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    /** Soft delete, like contacts (D30, D109). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("companies_team_id_id_key").on(t.teamId, t.id),
    index("companies_team_id_updated_at_idx").on(t.teamId, t.updatedAt.desc(), t.id.desc()),
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
