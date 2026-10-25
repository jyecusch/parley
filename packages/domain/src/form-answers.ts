import { countryCodeOf } from "./address.ts"
import { isEmailAddress, isPhoneNumber } from "./contact-values.ts"
import { type CustomField, checkCustomValue } from "./custom-field.ts"
import type { FormContent, FormField } from "./forms.ts"

/*
 * A visitor's answers to a form, checked one way for the browser (which checks early) and the
 * server (which enforces it), so the two always word a problem the same.
 */

/** The key a field's answer goes under: a contact field's name, "custom:<id>", or "topic:<id>" for consent. */
export const formFieldKey = (field: FormField): string =>
  field.kind === "contact"
    ? field.field
    : field.kind === "custom"
      ? `custom:${field.fieldId}`
      : `topic:${field.topicId}`

/** Short fields on the contact, and how long each may be. */
const TEXT_LIMITS: Readonly<Record<string, number>> = {
  firstName: 100,
  lastName: 100,
  company: 200,
  title: 100,
  city: 100,
  region: 100,
}

const ticked = (given: unknown) => given === true || given === "true" || given === "on"

/** Answers checked against the form and turned into contact values, or problems by field key. */
export const readAnswers = (
  content: FormContent,
  customFields: ReadonlyMap<string, CustomField>,
  raw: Readonly<Record<string, unknown>>,
): { readonly values: Record<string, unknown>; readonly problems: Record<string, string> } => {
  const values: Record<string, unknown> = {}
  const problems: Record<string, string> = {}
  for (const field of content.fields) {
    const key = formFieldKey(field)
    const given = raw[key]
    if (field.kind === "consent") {
      if (field.required && !ticked(given)) problems[key] = "Tick this to continue."
      values[key] = ticked(given)
      continue
    }
    const definition = field.kind === "custom" ? customFields.get(field.fieldId) : undefined
    const text = typeof given === "string" ? given.trim() : ""
    const missing = Array.isArray(given)
      ? given.length === 0
      : definition?.type === "checkbox"
        ? !ticked(given)
        : text === ""
    if (missing) {
      if (field.required) {
        problems[key] =
          field.kind === "contact" && field.field === "email"
            ? "Enter your email address."
            : `Enter ${field.label.toLowerCase()}.`
      }
      continue
    }
    if (field.kind === "contact") {
      switch (field.field) {
        case "email": {
          const email = text.toLowerCase()
          if (!isEmailAddress(email)) problems[key] = "Enter an email address like you@example.com."
          else values[key] = email
          break
        }
        case "phone": {
          const phone = text.replace(/[\s().-]/g, "")
          if (!isPhoneNumber(phone)) problems[key] = "Enter your number with its country code, like +61 400 000 000."
          else values[key] = phone
          break
        }
        case "country": {
          const code = countryCodeOf(text)
          if (!code) problems[key] = "We don't recognize that country."
          else values[key] = code
          break
        }
        default:
          if (text.length > (TEXT_LIMITS[field.field] ?? 200)) problems[key] = "That's too long."
          else values[key] = text
      }
      continue
    }
    if (!definition) continue
    const value =
      definition.type === "number"
        ? Number(text)
        : definition.type === "checkbox"
          ? ticked(given)
          : definition.type === "multi-select"
            ? Array.isArray(given)
              ? given.filter((entry): entry is string => typeof entry === "string")
              : []
            : text
    const fault = checkCustomValue(definition, value as never)
    if (fault) problems[key] = fault === "too-long" ? "That's too long." : "That isn't a valid answer here."
    else values[key] = value
  }
  return { values, problems }
}
