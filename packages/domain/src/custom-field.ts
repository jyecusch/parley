import { Schema } from "effect"
import { CustomFieldId } from "./ids.ts"
import { RecordType } from "./record-type.ts"

/** The types a custom field can have (D31). There's no reference-to-record type. */
export const CustomFieldType = Schema.Literals([
  "text",
  "number",
  "date",
  "checkbox",
  "single-select",
  "multi-select",
  "url",
  "email",
  "phone",
])
export type CustomFieldType = typeof CustomFieldType.Type

/** One choice of a select field. Its id stays put when its label is renamed, so values survive. */
export const SelectOption = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  label: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60)),
})
export type SelectOption = typeof SelectOption.Type

export const CustomField = Schema.Struct({
  id: CustomFieldId,
  recordType: RecordType,
  name: Schema.String,
  type: CustomFieldType,
  /** For select fields; empty otherwise. */
  options: Schema.Array(SelectOption),
  position: Schema.Number,
})
export type CustomField = typeof CustomField.Type

export const CustomFieldName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60))

/**
 * A custom field's value: text, a number, a date (YYYY-MM-DD), true or false, or a list of option ids.
 * Which one is allowed depends on the field's type; `checkCustomValue` says.
 */
export const CustomValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)])
export type CustomValue = typeof CustomValue.Type

/** Custom field values by field id. */
export const CustomValues = Schema.Record(Schema.String, CustomValue)
export type CustomValues = typeof CustomValues.Type

/** Changes to custom field values by field id. Null clears a value; fields not mentioned keep theirs. */
export const CustomValuesPatch = Schema.Record(Schema.String, Schema.NullOr(CustomValue)).annotate({
  title: "Custom fields",
  description:
    "Values by custom field id, from fields.list. Null clears a value. Fields you don't mention keep theirs.",
})
export type CustomValuesPatch = typeof CustomValuesPatch.Type

/** Built-in field names a custom field can't take (D68), compared case-insensitively. */
export const BUILT_IN_FIELD_NAMES: Readonly<Record<RecordType, ReadonlyArray<string>>> = {
  contact: ["first name", "last name", "name", "email", "emails", "phone", "phones", "companies", "created", "updated"],
  company: ["name", "domain", "domains", "website", "phone", "address", "contacts", "created", "updated"],
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const URL_PATTERN = /^https?:\/\/[^\s]+$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+[1-9]\d{6,14}$/

/**
 * Whether a value suits a field, and if not, why. Shared by the server (which enforces it) and the web
 * app (which checks early). Returns undefined when the value is fine.
 */
export const checkCustomValue = (
  field: Pick<CustomField, "type" | "options">,
  value: CustomValue,
): "wrong-type" | "invalid-format" | "too-long" | undefined => {
  const optionIds = new Set(field.options.map((option) => option.id))
  switch (field.type) {
    case "text":
      if (typeof value !== "string") return "wrong-type"
      return value.length > 2000 ? "too-long" : undefined
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "wrong-type"
    case "date":
      if (typeof value !== "string") return "wrong-type"
      return DATE.test(value) && !Number.isNaN(Date.parse(value)) ? undefined : "invalid-format"
    case "checkbox":
      return typeof value === "boolean" ? undefined : "wrong-type"
    case "single-select":
      if (typeof value !== "string") return "wrong-type"
      return optionIds.has(value) ? undefined : "invalid-format"
    case "multi-select":
      if (!Array.isArray(value)) return "wrong-type"
      return value.every((id) => optionIds.has(id)) ? undefined : "invalid-format"
    case "url":
      if (typeof value !== "string") return "wrong-type"
      return URL_PATTERN.test(value) && value.length <= 2000 ? undefined : "invalid-format"
    case "email":
      if (typeof value !== "string") return "wrong-type"
      return EMAIL.test(value) && value.length <= 254 ? undefined : "invalid-format"
    case "phone":
      if (typeof value !== "string") return "wrong-type"
      return PHONE.test(value) ? undefined : "invalid-format"
  }
}
