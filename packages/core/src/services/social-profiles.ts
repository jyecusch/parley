/**
 * Social profile links (D133) without repeats, in the order given. Links differing only in a
 * trailing slash or the host's case count as the same profile.
 */
export const uniqueProfiles = (profiles: ReadonlyArray<string>): Array<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const profile of profiles) {
    const key = sameProfileKey(profile)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(profile)
  }
  return out
}

const sameProfileKey = (url: string) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
  } catch {
    return url
  }
}
