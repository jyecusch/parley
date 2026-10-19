import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { Effect } from "effect"
import { normalizeImage } from "./images.ts"

/**
 * Fetches a company's icon from its domain (D75) through SSRF-safe egress: only https, only public
 * addresses (checked for every hop of a redirect), a short timeout, and a size cap. Tries the
 * apple-touch icon, the page's declared icons, then /favicon.ico. Any failure just means no logo.
 */

const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 5000

/** Private, loopback, link-local, carrier-grade NAT, multicast and reserved ranges are refused. */
export const isPublicAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number)
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 192 && b === 0) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    return true
  }
  const lower = address.toLowerCase()
  if (lower === "::1" || lower === "::") return false
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("ff"))
    return false
  if (lower.startsWith("::ffff:")) return isPublicAddress(lower.slice(7))
  return true
}

const safeHost = async (host: string) => {
  if (isIP(host)) return isPublicAddress(host)
  const addresses = await lookup(host, { all: true })
  return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address))
}

/** GET with every redirect target re-checked, a timeout and a size cap. */
const safeFetch = async (start: string): Promise<{ bytes: Uint8Array; type: string; url: string } | undefined> => {
  let url = new URL(start)
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" || !(await safeHost(url.hostname))) return undefined
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location")
      if (!next) return undefined
      url = new URL(next, url)
      continue
    }
    if (!response.ok || !response.body) return undefined
    const declared = Number(response.headers.get("content-length") ?? 0)
    if (declared > MAX_BYTES) return undefined
    const reader = response.body.getReader()
    const chunks: Array<Uint8Array> = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes, type: response.headers.get("content-type") ?? "", url: url.toString() }
  }
  return undefined
}

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

const tryIcon = async (url: string): Promise<Uint8Array | undefined> => {
  const fetched = await safeFetch(url)
  if (!fetched) return undefined
  if (fetched.type.includes("icon") || url.endsWith(".ico")) return pngInsideIco(fetched.bytes)
  if (fetched.type.startsWith("image/")) return fetched.bytes
  return undefined
}

/** The domain's icon as a stored image, or undefined. Never fails. */
export const fetchFavicon = (domain: string): Effect.Effect<Uint8Array | undefined> =>
  Effect.tryPromise(async () => {
    try {
      const origin = `https://${domain}`
      const candidates = [`${origin}/apple-touch-icon.png`]
      const page = await safeFetch(`${origin}/`)
      if (page?.type.includes("html")) {
        candidates.push(...iconLinks(new TextDecoder().decode(page.bytes.subarray(0, 200_000)), page.url))
      }
      candidates.push(`${origin}/favicon.ico`)
      for (const candidate of candidates) {
        const icon = await tryIcon(candidate).catch(() => undefined)
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
