const UNITS: ReadonlyArray<readonly [number, string]> = [
  [60, "s"],
  [60, "m"],
  [24, "h"],
  [7, "d"],
  [4.345, "w"],
  [12, "mo"],
  [Number.POSITIVE_INFINITY, "y"],
]

/** Short relative time ("2h", "3d"), the same everywhere. The full time goes in a title. */
export const relative = (iso: string, now = Date.now()): string => {
  let value = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (value < 45) return "now"
  for (const [size, unit] of UNITS) {
    if (value < size) return `${Math.max(1, Math.floor(value))}${unit}`
    value /= size
  }
  return ""
}

export const absolute = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

/** "2h ago", or "just now". */
export const ago = (iso: string, now = Date.now()): string => {
  const short = relative(iso, now)
  return short === "now" ? "just now" : `${short} ago`
}
