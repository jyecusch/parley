import { Schema } from "effect"

/** Contact or company. */
export const RecordType = Schema.Literals(["contact", "company"])
export type RecordType = typeof RecordType.Type
