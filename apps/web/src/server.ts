import { FONT_HOSTS, isUuid } from "@parley/domain"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { handle } from "./server/app.ts"

/**
 * Headers every response gets. No page may be framed by another site, so a page like the agent
 * consent screen can't be overlaid and clicked through (clickjacking). The one exception is a
 * form's page (/f/<form id>), which exists to be framed: by the sites its team allows (D144).
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
}

/** A form's page: /f/<form id>, where the id is a uuid (anything else is another page). */
const FORM_PAGE = /^\/f\/([^/]+)\/?$/

/**
 * A form's page and its confirmation page take stylesheets and fonts only from Parley and the font
 * services a form may use (D148), so no stylesheet that gets past the appearance checks can load.
 * Inline styles stay: the form's own appearance is one.
 */
const FORM_STYLES = `style-src 'self' 'unsafe-inline' ${FONT_HOSTS.map((host) => `https://${host}`).join(" ")}; font-src 'self' data: https://fonts.gstatic.com https://fonts.bunny.net https://use.typekit.net`

/**
 * The frame-ancestors for a form's page: any site when the team hasn't limited it, else the
 * sites it allows ("nitric.io", "*.nitric.io") over https, and Parley itself (for previews).
 * If the lookup fails, only Parley may frame it.
 */
const formFrameAncestors = async (request: Request, formId: string): Promise<string> => {
  try {
    const response = await handle(new Request(new URL(`/api/forms/${formId}/sites`, request.url)))
    if (!response.ok) return "'self'"
    const { allowedSites } = (await response.json()) as { allowedSites: ReadonlyArray<string> | null }
    if (allowedSites === null) return "*"
    return ["'self'", ...allowedSites.map((site) => `https://${site}`)].join(" ")
  } catch {
    return "'self'"
  }
}

export default createServerEntry({
  async fetch(request, options) {
    const response = await handler.fetch(request, options)
    const headers = new Headers(response.headers)
    const form = FORM_PAGE.exec(new URL(request.url).pathname)
    const security: Record<string, string> = { ...SECURITY_HEADERS }
    if (form?.[1] && isUuid(form[1]) && request.method === "GET") {
      security["content-security-policy"] =
        `${FORM_STYLES}; frame-ancestors ${await formFrameAncestors(request, form[1])}`
      delete security["x-frame-options"]
    } else if (new URL(request.url).pathname.startsWith("/f/confirm/")) {
      security["content-security-policy"] = `${FORM_STYLES}; frame-ancestors 'none'`
    }
    for (const [name, value] of Object.entries(security)) {
      // A route's own policy (the file route sets one) is kept; frame-ancestors is added to it.
      if (name === "content-security-policy" && headers.has(name)) {
        headers.set(name, `${headers.get(name)}; ${value}`)
      } else if (!headers.has(name)) headers.set(name, value)
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
})
