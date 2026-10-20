import { lookup } from "node:dns/promises"
import https from "node:https"
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
/** The whole search, however many candidates and redirects, never takes longer than this. */
const DEADLINE_MS = 15_000
/** A page can declare many icons; only the first few are tried. */
const MAX_CANDIDATES = 5

const isPublicV4 = (address: string): boolean => {
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

/** An IPv6 address as eight 16-bit groups, with any dotted IPv4 tail folded in. */
const groupsOf = (address: string): Array<number> | undefined => {
  let text = address.toLowerCase().split("%")[0] ?? ""
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1]
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.split(".").map(Number)
    text = `${text.slice(0, -v4.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = "", tail] = text.split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const missing = 8 - left.length - right.length
  if (tail === undefined ? left.length !== 8 : missing < 0) return undefined
  const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right].map((group) =>
    Number.parseInt(group, 16),
  )
  return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : undefined
}

const v4Of = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`

/**
 * Private, loopback, link-local, carrier-grade NAT, multicast and reserved ranges are refused, in
 * IPv4 and in every IPv6 form that carries an IPv4 address (mapped, compatible, NAT64, 6to4).
 */
export const isPublicAddress = (address: string): boolean => {
  if (isIP(address) === 4) return isPublicV4(address)
  if (isIP(address) !== 6) return false
  const g = groupsOf(address)
  if (!g) return false
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g
  const zeroTo = (n: number) => g.slice(0, n).every((group) => group === 0)
  if (zeroTo(8) || (zeroTo(7) && g7 === 1)) return false // :: and ::1
  if (zeroTo(5) && g5 === 0xffff) return isPublicV4(v4Of(g6, g7)) // ::ffff:a.b.c.d
  if (zeroTo(6)) return isPublicV4(v4Of(g6, g7)) // ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b && zeroTo(0) && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return isPublicV4(v4Of(g6, g7)) // NAT64
  if (g0 === 0x2002) return isPublicV4(v4Of(g1, g2)) // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return false // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return false // link- and site-local
  if ((g0 & 0xff00) === 0xff00) return false // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false // discard
  return true
}

/**
 * Resolves a host for the connection itself, refusing unless every address is public. Because the
 * connection uses exactly these addresses, a second lookup can't rebind it to an internal one.
 */
const vettedLookup = (
  host: string,
  options: unknown,
  callback: (
    error: Error | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => {
  lookup(host, { all: true }).then(
    (addresses) => {
      if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
        callback(new Error(`refusing a non-public address for ${host}`), [])
        return
      }
      if ((options as { readonly all?: boolean } | undefined)?.all) callback(null, addresses)
      else callback(null, addresses[0]?.address ?? "", addresses[0]?.family)
    },
    (error: Error) => callback(error, []),
  )
}

/** One https GET, connecting only to vetted addresses, with a timeout and a size cap. Redirects aren't followed. */
const getOnce = (url: URL, signal: AbortSignal) =>
  new Promise<{ status: number; location: string | undefined; type: string; bytes: Uint8Array | undefined }>(
    (resolve, reject) => {
      const literal = url.hostname.replace(/^\[|\]$/g, "")
      if (isIP(literal) && !isPublicAddress(literal)) return reject(new Error("refusing a non-public address"))
      const request = https.request(
        url,
        { method: "GET", lookup: vettedLookup, signal, timeout: TIMEOUT_MS },
        (response) => {
          const status = response.statusCode ?? 0
          const location = response.headers.location
          const type = String(response.headers["content-type"] ?? "")
          if (status >= 300 || Number(response.headers["content-length"] ?? 0) > MAX_BYTES) {
            response.destroy()
            return resolve({ status, location, type, bytes: undefined })
          }
          const chunks: Array<Buffer> = []
          let size = 0
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength
            if (size > MAX_BYTES) response.destroy(new Error("too large"))
            else chunks.push(chunk)
          })
          response.on("end", () => resolve({ status, location, type, bytes: new Uint8Array(Buffer.concat(chunks)) }))
          response.on("error", reject)
        },
      )
      request.on("timeout", () => request.destroy(new Error("timed out")))
      request.on("error", reject)
      request.end()
    },
  )

/** GET with every redirect target re-checked. */
const safeFetch = async (
  start: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; type: string; url: string } | undefined> => {
  let url = new URL(start)
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:") return undefined
    const response = await getOnce(url, signal)
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return undefined
      url = new URL(response.location, url)
      continue
    }
    if (response.status !== 200 || !response.bytes) return undefined
    return { bytes: response.bytes, type: response.type, url: url.toString() }
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

const tryIcon = async (url: string, signal: AbortSignal): Promise<Uint8Array | undefined> => {
  const fetched = await safeFetch(url, signal)
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
      const page = await safeFetch(`${origin}/`, signal)
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
