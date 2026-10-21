import { Schema } from "effect"

/** A social profile link (D133): an https address, such as https://www.linkedin.com/company/acme. */
export const SocialProfile = Schema.String.check(
  Schema.isMaxLength(500),
  Schema.isPattern(/^https:\/\/[^\s/]+\.[^\s]+$/i),
).annotate({
  title: "Social profile",
  description: "An https link to a profile, such as https://www.linkedin.com/company/acme or https://x.com/acme.",
})

export const SocialProfiles = Schema.Array(SocialProfile).check(Schema.isMaxLength(20))

/**
 * The networks Parley recognises, by the hosts their profiles live on (D133). `handle` turns a
 * bare handle (as some exports give, like "acme" or "@acme") into the profile's address; LinkedIn's
 * differs for people and companies.
 */
export const SOCIAL_NETWORKS = [
  {
    id: "linkedin",
    label: "LinkedIn",
    hosts: ["linkedin.com"],
    handle: (h: string, recordType: "contact" | "company") =>
      `https://www.linkedin.com/${recordType === "company" ? "company" : "in"}/${h}`,
  },
  { id: "x", label: "X", hosts: ["x.com", "twitter.com"], handle: (h: string) => `https://x.com/${h}` },
  {
    id: "facebook",
    label: "Facebook",
    hosts: ["facebook.com", "fb.com"],
    handle: (h: string) => `https://www.facebook.com/${h}`,
  },
  {
    id: "instagram",
    label: "Instagram",
    hosts: ["instagram.com"],
    handle: (h: string) => `https://www.instagram.com/${h}`,
  },
  {
    id: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "youtu.be"],
    handle: (h: string) => `https://www.youtube.com/@${h}`,
  },
  { id: "github", label: "GitHub", hosts: ["github.com"], handle: (h: string) => `https://github.com/${h}` },
  { id: "bluesky", label: "Bluesky", hosts: ["bsky.app"], handle: (h: string) => `https://bsky.app/profile/${h}` },
  {
    id: "threads",
    label: "Threads",
    hosts: ["threads.net", "threads.com"],
    handle: (h: string) => `https://www.threads.net/@${h}`,
  },
  { id: "tiktok", label: "TikTok", hosts: ["tiktok.com"], handle: (h: string) => `https://www.tiktok.com/@${h}` },
] as const
export type SocialNetworkId = (typeof SOCIAL_NETWORKS)[number]["id"]

/** Which network a profile link is on, or undefined for a link Parley doesn't recognise. */
export const socialNetworkOf = (url: string) => {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "")
  } catch {
    return undefined
  }
  return SOCIAL_NETWORKS.find((network) =>
    (network.hosts as ReadonlyArray<string>).some((entry) => host === entry || host.endsWith(`.${entry}`)),
  )
}

/**
 * A cell from an import column for one network (D133) as a profile link: an address as given
 * (https added if missing), or a bare handle made into the network's address. Undefined when
 * it's neither.
 */
export const socialProfileFrom = (
  network: SocialNetworkId,
  text: string,
  recordType: "contact" | "company",
): string | undefined => {
  const value = text.trim()
  if (value === "") return undefined
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\//i.test(value)) {
    const url = value.replace(/^http:\/\//i, "https://").replace(/^(?!https:\/\/)/i, "https://")
    return Schema.is(SocialProfile)(url) ? url : undefined
  }
  const handle = value.replace(/^@/, "")
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(handle)) return undefined
  const found = SOCIAL_NETWORKS.find((entry) => entry.id === network)
  return found ? found.handle(handle, recordType) : undefined
}
