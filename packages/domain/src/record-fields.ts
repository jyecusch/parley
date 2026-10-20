import type { Company } from "./company.ts"
import type { Contact } from "./contact.ts"
import { customFieldValue, type FieldValue } from "./filter.ts"

/** How a contact reads for filters, matching the server's SQL field by field. */
export const contactFieldReader =
  (contact: Contact) =>
  (field: string): FieldValue => {
    if (field.startsWith("custom:")) return customFieldValue(contact.custom[field.slice(7)])
    switch (field) {
      case "name":
        return [contact.firstName, contact.lastName].filter(Boolean).join(" ")
      case "email":
        return contact.emails.map((email) => email.address)
      case "phone":
        return contact.phones.map((phone) => phone.number)
      case "company":
        return contact.affiliations.map((affiliation) => affiliation.companyId)
      case "subscriptionStatus":
        return contact.subscriptionStatus
      case "owner":
        return contact.ownerId
      case "city":
        return contact.address?.city ?? null
      case "country":
        return contact.address?.country ?? null
      case "createdAt":
        return contact.createdAt
      case "updatedAt":
        return contact.updatedAt
      default:
        return null
    }
  }

/** How a company reads for filters, matching the server's SQL field by field. */
export const companyFieldReader =
  (company: Company) =>
  (field: string): FieldValue => {
    if (field.startsWith("custom:")) return customFieldValue(company.custom[field.slice(7)])
    switch (field) {
      case "name":
        return company.name
      case "domain":
        return company.domains.map((entry) => entry.domain)
      case "website":
        return company.website
      case "country":
        return company.address?.country ?? null
      case "contactCount":
        return company.contactCount
      case "owner":
        return company.ownerId
      case "createdAt":
        return company.createdAt
      case "updatedAt":
        return company.updatedAt
      default:
        return null
    }
  }
