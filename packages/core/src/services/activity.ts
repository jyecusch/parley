import type { schema } from "@parley/db"
import type { ActivityEntry, RecordType, TeamId, Tracking } from "@parley/domain"
import { type Actor, attribution } from "../principal.ts"

/** The other record an affiliation change was about, named as it was at the time. */
export interface RelatedRecord {
  readonly recordType: RecordType | "broadcast" | "form"
  readonly id: string
  readonly name: string
}

/** One activity row, attributed to the principal (D78, D96). Services insert these inside their own writes. */
export const activityRow = (
  principal: Actor,
  entry: {
    readonly teamId: TeamId
    readonly recordType: RecordType
    readonly recordId: string
    readonly kind: ActivityEntry["kind"]
    readonly changedFields?: ReadonlyArray<string>
    readonly related?: RelatedRecord
    readonly reason?: "domain-matching"
    readonly matchedDomain?: string
    readonly topicName?: string
    /** For "submitted-form": values not written because the contact had one (D145). */
    readonly kept?: ReadonlyArray<{ readonly field: string; readonly label: string; readonly value: unknown }>
    /** For "submitted-form": where the sign-up came from (D153). */
    readonly tracking?: Tracking | null
  },
): typeof schema.activity.$inferInsert => ({
  id: crypto.randomUUID(),
  teamId: entry.teamId,
  recordType: entry.recordType,
  recordId: entry.recordId,
  kind: entry.kind,
  changedFields: [...(entry.changedFields ?? [])],
  relatedRecordType: entry.related?.recordType ?? null,
  relatedRecordId: entry.related?.id ?? null,
  relatedName: entry.related?.name ?? null,
  reason: entry.reason ?? null,
  matchedDomain: entry.matchedDomain ?? null,
  topicName: entry.topicName ?? null,
  kept: [...(entry.kept ?? [])],
  tracking: entry.tracking
    ? { page: entry.tracking.page, utm: { ...entry.tracking.utm }, clickIds: { ...entry.tracking.clickIds } }
    : null,
  ...attribution(principal),
})

export const toActivityEntry = (row: typeof schema.activity.$inferSelect): ActivityEntry => ({
  id: row.id,
  actorName: row.actorName,
  via: row.viaName,
  kind: row.kind,
  changedFields: row.changedFields,
  kept: row.kept,
  tracking: row.tracking ?? null,
  related:
    row.relatedRecordType && row.relatedRecordId && row.relatedName
      ? { recordType: row.relatedRecordType, id: row.relatedRecordId, name: row.relatedName }
      : null,
  reason: row.reason,
  matchedDomain: row.matchedDomain,
  topicName: row.topicName,
  at: row.at.toISOString(),
})
