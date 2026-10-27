/**
 * Who may create an account (D163): the domains in PARLEY_SIGNUP_DOMAINS ("*" for any), or
 * nobody when it's unset. Accounts for invited addresses, and the first account on a new server,
 * are allowed apart from this.
 */
export type SignUpDomains = { readonly _tag: "Any" } | { readonly _tag: "Only"; readonly domains: ReadonlySet<string> }

/** The setting as written: "nitric.io, suga.app", "*" or empty. */
export const signUpDomainsOf = (setting: string): SignUpDomains => {
  const entries = setting
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter((entry) => entry !== "")
  return entries.includes("*") ? { _tag: "Any" } : { _tag: "Only", domains: new Set(entries) }
}

/** Whether an address's domain may sign up on its own, without an invitation. */
export const domainMaySignUp = (domains: SignUpDomains, email: string): boolean => {
  if (domains._tag === "Any") return true
  const address = email.trim().toLowerCase()
  return domains.domains.has(address.slice(address.lastIndexOf("@") + 1))
}
