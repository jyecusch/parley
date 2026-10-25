import type { ActivityEntry, Contact, ContactFields, CustomField, CustomValue, PhoneNumber } from "@parley/domain"
import { formatValue } from "./custom-fields.ts"

/** A value a form submission didn't write because the contact already had one (D145). */
export type KeptValue = ActivityEntry["kept"][number]

const EMPTY_ADDRESS = { line1: null, line2: null, city: null, region: null, postcode: null, country: null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A kept value as the contact panel shows it: an option's label rather than its id, Yes or No. */
export const keptText = (kept: KeptValue, fields: ReadonlyArray<CustomField>) => {
  const field = kept.field.startsWith("custom:")
    ? fields.find((entry) => entry.id === kept.field.slice("custom:".length))
    : undefined
  if (field) return formatValue(field, kept.value as CustomValue)
  return typeof kept.value === "string" ? kept.value : JSON.stringify(kept.value)
}

/** Whether the contact already has the kept value, so applying it would change nothing. */
export const keptApplied = (kept: KeptValue, contact: Contact) => {
  const { field, value } = kept
  if (field.startsWith("custom:")) return same(contact.custom[field.slice("custom:".length)], value)
  if (field === "city" || field === "region" || field === "country") return contact.address?.[field] === value
  if (field === "phone") return contact.phones.some((phone) => phone.number === value)
  if (field === "firstName" || field === "lastName") return contact[field] === value
  return false
}

/**
 * The contacts.update change that writes a kept value: a custom field, a name, a part of the
 * address, or the number added as the first phone (the others stay).
 */
export const keptChange = (kept: KeptValue, contact: Contact): ContactFields | undefined => {
  const { field, value } = kept
  if (field.startsWith("custom:")) return { custom: { [field.slice("custom:".length)]: value as CustomValue } }
  if (field === "city" || field === "region" || field === "country") {
    return { address: { ...EMPTY_ADDRESS, ...contact.address, [field]: value as string } }
  }
  if (field === "phone") {
    return {
      phones: [
        // The form checked it as a phone number when it was submitted.
        { number: value as PhoneNumber, label: null },
        ...contact.phones.map((phone) => ({ number: phone.number, label: phone.label })),
      ],
    }
  }
  if (field === "firstName" || field === "lastName") return { [field]: value as string }
  return undefined
}
