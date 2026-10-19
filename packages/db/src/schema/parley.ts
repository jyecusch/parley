import { sql } from "drizzle-orm"
import {
  boolean,
  foreignKey,
  index,
  integer,
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
    recordType: text("record_type", { enum: ["contact"] }).notNull(),
    recordId: uuid("record_id").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The name shown at the time, kept if the user is later removed. */
    actorName: text("actor_name").notNull(),
    viaApiKeyId: text("via_api_key_id"),
    viaConnectionId: uuid("via_connection_id"),
    /** The API key's or connection's name at the time ("Claude on my laptop", D78). */
    viaName: text("via_name"),
    kind: text("kind", { enum: ["created", "updated", "deleted", "restored"] }).notNull(),
    changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
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
