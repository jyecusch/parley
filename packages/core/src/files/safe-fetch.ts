import { lookup } from "node:dns/promises"
import https from "node:https"
import { isIP } from "node:net"

/**
 * SSRF-safe egress for fetching from addresses people type (D75, D120): only https, only public
 * addresses (checked for every hop of a redirect, and pinned for the connection itself), a timeout,
 * and a size cap.
 */

/** Each request, not counting redirects, gives up after this. */
const TIMEOUT_MS = 5000

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
const getOnce = (url: URL, signal: AbortSignal, maxBytes: number) =>
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
          if (status >= 300 || Number(response.headers["content-length"] ?? 0) > maxBytes) {
            response.destroy()
            return resolve({ status, location, type, bytes: undefined })
          }
          const chunks: Array<Buffer> = []
          let size = 0
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength
            if (size > maxBytes) response.destroy(new Error("too large"))
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
export const safeFetch = async (
  start: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; type: string; url: string } | undefined> => {
  let url = new URL(start)
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:") return undefined
    const response = await getOnce(url, signal, maxBytes)
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
