import type { CustomField, CustomValue, RecordType, TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { call } from "./client.ts"

/** A team's custom fields for one record type, in order. */
export const useFields = (teamId: TeamId, recordType: RecordType) => {
  const query = useQuery({ queryKey: ["fields", teamId], queryFn: () => call("fields.list", { teamId }) })
  return {
    ...query,
    fields: (query.data ?? []).filter((field) => field.recordType === recordType),
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })

/** A value as text, for cells and read-only display. */
export const formatValue = (field: CustomField, value: CustomValue | undefined): string => {
  if (value === undefined) return ""
  switch (field.type) {
    case "checkbox":
      return value === true ? "Yes" : "No"
    case "date":
      return typeof value === "string" ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : ""
    case "number":
      return typeof value === "number" ? value.toLocaleString() : ""
    case "single-select":
      return field.options.find((option) => option.id === value)?.label ?? ""
    case "multi-select":
      return Array.isArray(value)
        ? value
            .map((id) => field.options.find((option) => option.id === id)?.label ?? "")
            .filter(Boolean)
            .join(", ")
        : ""
    default:
      return typeof value === "string" ? value : ""
  }
}

/**
 * What a collection update sends for custom values: the changed ones, and null for ones removed.
 * Values are a patch on the server, so anything not mentioned stays.
 */
export const customPatch = (
  before: Readonly<Record<string, CustomValue>>,
  after: Readonly<Record<string, CustomValue>>,
): Record<string, CustomValue | null> => {
  const patch: Record<string, CustomValue | null> = {}
  for (const [id, value] of Object.entries(after)) {
    if (JSON.stringify(before[id]) !== JSON.stringify(value)) patch[id] = value
  }
  for (const id of Object.keys(before)) if (!(id in after)) patch[id] = null
  return patch
}

/** Which custom fields show as columns in an index view, per team and record type, per browser. */
const columnsKey = (teamId: TeamId, recordType: RecordType) => `parley.columns.${teamId}.${recordType}`

export const readColumns = (teamId: TeamId, recordType: RecordType): ReadonlyArray<string> => {
  try {
    const raw = localStorage.getItem(columnsKey(teamId, recordType))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

export const writeColumns = (teamId: TeamId, recordType: RecordType, ids: ReadonlyArray<string>) => {
  try {
    localStorage.setItem(columnsKey(teamId, recordType), JSON.stringify(ids))
  } catch {}
}
