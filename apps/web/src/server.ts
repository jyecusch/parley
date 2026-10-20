import handler, { createServerEntry } from "@tanstack/react-start/server-entry"

/**
 * Headers every response gets. No page may be framed by another site, so a page like the agent
 * consent screen can't be overlaid and clicked through (clickjacking).
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
}

export default createServerEntry({
  async fetch(request, options) {
    const response = await handler.fetch(request, options)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      // A route's own policy (the file route sets one) is kept; frame-ancestors is added to it.
      if (name === "content-security-policy" && headers.has(name)) {
        headers.set(name, `${headers.get(name)}; ${value}`)
      } else if (!headers.has(name)) headers.set(name, value)
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
})
