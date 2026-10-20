import type { PostalAddress } from "@parley/domain"

const ADDRESS_KEYS = ["line1", "line2", "city", "region", "postcode", "country"] as const

/** An address with nothing in it is no address. Shared by companies and contacts (D104, D128). */
export const normalizeAddress = (address: PostalAddress | null): PostalAddress | null =>
  address && ADDRESS_KEYS.some((key) => address[key]) ? address : null

/** An address as the columns companies and contacts both store it in. */
export const addressColumns = (address: PostalAddress | null) => ({
  addressLine1: address?.line1 ?? null,
  addressLine2: address?.line2 ?? null,
  city: address?.city ?? null,
  region: address?.region ?? null,
  postcode: address?.postcode ?? null,
  country: address?.country ?? null,
})

/** The address in a company's or contact's row, or null when it has none. */
export const addressOfRow = (row: {
  readonly addressLine1: string | null
  readonly addressLine2: string | null
  readonly city: string | null
  readonly region: string | null
  readonly postcode: string | null
  readonly country: string | null
}): PostalAddress | null =>
  normalizeAddress({
    line1: row.addressLine1,
    line2: row.addressLine2,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    country: row.country,
  })
