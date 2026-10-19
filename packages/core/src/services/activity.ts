import type { schema } from "@parley/db"
import type { ActivityEntry, RecordType, TeamId } from "@parley/domain"
import { attribution, type Principal } from "../principal.ts"

/** The other record an affiliation change was about, named as it was at the time. */
export interface RelatedRecord {
  readonly recordType: RecordType
  readonly id: string
  readonly name: string
}

/** One activity row, attributed to the principal (D78, D96). Services insert these inside their own writes. */
export const activityRow = (
  principal: Principal,
  entry: {
    readonly teamId: TeamId
    readonly recordType: RecordType
    readonly recordId: string
    readonly kind: ActivityEntry["kind"]
    readonly changedFields?: ReadonlyArray<string>
    readonly related?: RelatedRecord
    readonly reason?: "domain-matching"
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
  ...attribution(principal),
})

export const toActivityEntry = (row: typeof schema.activity.$inferSelect): ActivityEntry => ({
  id: row.id,
  actorName: row.actorName,
  via: row.viaName,
  kind: row.kind,
  changedFields: row.changedFields,
  related:
    row.relatedRecordType && row.relatedRecordId && row.relatedName
      ? { recordType: row.relatedRecordType, id: row.relatedRecordId, name: row.relatedName }
      : null,
  reason: row.reason,
  at: row.at.toISOString(),
})
