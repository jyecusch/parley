import { Schema } from "effect"

const Line = Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(200))

/** A postal address (D104, D128): a company's or a contact's. Country is an ISO 3166-1 alpha-2 code, such as "AU". */
export const PostalAddress = Schema.Struct({
  line1: Schema.NullOr(Line.annotate({ title: "Street" })),
  line2: Schema.NullOr(Line.annotate({ title: "Street, line 2" })),
  city: Schema.NullOr(Line.annotate({ title: "City" })),
  region: Schema.NullOr(Line.annotate({ title: "State or region" })),
  postcode: Schema.NullOr(
    Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(20)).annotate({ title: "Postcode" }),
  ),
  country: Schema.NullOr(
    Schema.String.check(Schema.isPattern(/^[A-Z]{2}$/)).annotate({
      title: "Country",
      description: "ISO 3166-1 alpha-2 code, such as AU or US.",
    }),
  ),
})

export type PostalAddress = typeof PostalAddress.Type

/** Every ISO 3166-1 alpha-2 code the runtime knows, with its English name, built once. */
let countries: ReadonlyMap<string, string> | undefined
const countryNames = () => {
  if (countries) return countries
  const names = new Map<string, string>()
  const display = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" })
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second)
      const name = display.of(code)
      if (name && name !== code) names.set(name.toLowerCase(), code)
    }
  }
  // Common ways of writing a few countries that aren't their official English names.
  for (const [alias, code] of [
    ["usa", "US"],
    ["united states of america", "US"],
    ["uk", "GB"],
    ["great britain", "GB"],
    ["england", "GB"],
    ["south korea", "KR"],
    ["russia", "RU"],
    ["vietnam", "VN"],
  ] as const)
    names.set(alias, code)
  countries = names
  return names
}

/**
 * A country's ISO 3166-1 alpha-2 code from a code ("au") or an English name ("Australia"), as
 * CRM exports write it (D128). Undefined when it isn't a country Parley knows.
 */
export const countryCodeOf = (text: string): string | undefined => {
  const value = text.trim()
  if (/^[A-Za-z]{2}$/.test(value)) {
    const code = value.toUpperCase()
    return [...countryNames().values()].includes(code) ? code : undefined
  }
  return countryNames().get(value.toLowerCase())
}
