import { Effect } from "effect"
import { normalizeImage } from "./images.ts"
import { safeFetch } from "./safe-fetch.ts"

export { isPublicAddress } from "./safe-fetch.ts"

/**
 * Fetches a company's icon from its domain (D75) through SSRF-safe egress: only https, only public
 * addresses (checked for every hop of a redirect), a short timeout, and a size cap. Tries the
 * apple-touch icon, the page's declared icons, then /favicon.ico. Any failure just means no logo.
 */

const MAX_BYTES = 1024 * 1024
/** The whole search, however many candidates and redirects, never takes longer than this. */
const DEADLINE_MS = 15_000
/** A page can declare many icons; only the first few are tried. */
const MAX_CANDIDATES = 5

/** An .ico usually holds a PNG inside; that's the only kind this reads. */
const pngInsideIco = (bytes: Uint8Array): Uint8Array | undefined => {
  if (bytes.byteLength < 6 || bytes[0] !== 0 || bytes[2] !== 1) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(4, true)
  let best: Uint8Array | undefined
  let bestSize = 0
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16
    if (entry + 16 > bytes.byteLength) break
    const size = view.getUint32(entry + 8, true)
    const offset = view.getUint32(entry + 12, true)
    const data = bytes.subarray(offset, offset + size)
    const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    if (isPng && size > bestSize) {
      best = data
      bestSize = size
    }
  }
  return best
}

const iconLinks = (html: string, base: string): Array<string> =>
  [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /rel\s*=\s*["']?[^"'>]*icon/i.test(tag))
    .map((tag) => /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1])
    .filter((href): href is string => Boolean(href))
    .map((href) => {
      try {
        return new URL(href, base).toString()
      } catch {
        return ""
      }
    })
    .filter(Boolean)

const tryIcon = async (url: string, signal: AbortSignal): Promise<Uint8Array | undefined> => {
  const fetched = await safeFetch(url, signal, MAX_BYTES)
  if (!fetched) return undefined
  if (fetched.type.includes("icon") || url.endsWith(".ico")) return pngInsideIco(fetched.bytes)
  if (fetched.type.startsWith("image/")) return fetched.bytes
  return undefined
}

/** The domain's icon as a stored image, or undefined. Never fails. */
export const fetchFavicon = (domain: string): Effect.Effect<Uint8Array | undefined> =>
  Effect.tryPromise(async () => {
    const signal = AbortSignal.timeout(DEADLINE_MS)
    try {
      const origin = `https://${domain}`
      const candidates = [`${origin}/apple-touch-icon.png`]
      const page = await safeFetch(`${origin}/`, signal, MAX_BYTES)
      if (page?.type.includes("html")) {
        const declared = iconLinks(new TextDecoder().decode(page.bytes.subarray(0, 200_000)), page.url)
        candidates.push(...declared.slice(0, MAX_CANDIDATES))
      }
      candidates.push(`${origin}/favicon.ico`)
      for (const candidate of candidates) {
        if (signal.aborted) return undefined
        const icon = await tryIcon(candidate, signal).catch(() => undefined)
        if (icon && icon.byteLength > 0) return icon
      }
      return undefined
    } catch {
      return undefined
    }
  }).pipe(
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((icon) =>
      icon
        ? Effect.match(normalizeImage(icon), { onFailure: () => undefined, onSuccess: (image) => image })
        : Effect.succeed(undefined),
    ),
  )
