/**
 * Domains anyone can get an email address at. They can never be a company's domain, so domain
 * matching never links contacts through them (D106). Browser-safe, so forms can check early.
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hey.com",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.fr",
  "icloud.com",
  "live.com",
  "mac.com",
  "mail.com",
  "mail.ru",
  "me.com",
  "msn.com",
  "naver.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "rocketmail.com",
  "tutanota.com",
  "web.de",
  "yahoo.co.uk",
  "yahoo.com",
  "yahoo.fr",
  "yandex.com",
  "yandex.ru",
  "ymail.com",
  "zoho.com",
  "163.com",
  "126.com",
])

/** "WWW.Acme.com." → "acme.com". Domains are stored this way. */
export const normalizeDomain = (domain: string): string =>
  domain
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "")

export const isFreeEmailDomain = (domain: string): boolean => FREE_EMAIL_DOMAINS.has(normalizeDomain(domain))

/** The domain of an email address, normalized. */
export const domainOfEmail = (address: string): string => normalizeDomain(address.slice(address.lastIndexOf("@") + 1))
