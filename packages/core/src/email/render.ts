import type { RenderedEmail } from "@parley/domain"
import { Marked } from "marked"

/** The merge tags Parley fills in (R41). */
export const MERGE_TAGS = ["first_name", "last_name", "name", "email", "company"] as const
export type MergeTag = (typeof MERGE_TAGS)[number]
export type MergeValues = Readonly<Record<MergeTag, string>>

/** A recipient's values for the merge tags, from a contact. */
export const mergeValuesOf = (contact: {
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string | null
  readonly company: string | null
}): MergeValues => ({
  first_name: contact.firstName ?? "",
  last_name: contact.lastName ?? "",
  name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
  email: contact.email ?? "",
  company: contact.company ?? "",
})

/** Values for a preview or test send without a contact, so the email reads naturally. */
export const SAMPLE_VALUES: MergeValues = {
  first_name: "Sam",
  last_name: "Taylor",
  name: "Sam Taylor",
  email: "sam@example.com",
  company: "Example Co",
}

/** The footer every campaign email ends with (R40). Null link: a preview, which has none yet. */
export interface Footer {
  readonly legalName: string
  readonly postalAddress: string
  readonly reason: string
  readonly unsubscribeUrl: string | null
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  )

/** A merge tag, with an optional fallback of plain words: no braces, markup characters or new lines. */
const TAG = /\{\{\s*([a-zA-Z_]+)\s*(?:\|([^{}<>"&\n]{0,100}))?\}\}/g

/** Fills merge tags. Unknown tags are left as typed and reported, so a typo is visible in the preview. */
const fill = (text: string, values: MergeValues, encode: (value: string) => string, unknown: Set<string>) =>
  text.replace(TAG, (whole, name: string, fallback: string | undefined) => {
    const key = name.toLowerCase()
    if (!(MERGE_TAGS as ReadonlyArray<string>).includes(key)) {
      unknown.add(name)
      return encode(whole)
    }
    const value = values[key as MergeTag].trim() || (fallback ?? "").trim()
    return encode(value)
  })

const SAFE_LINK = /^(https?:|mailto:)/i

/**
 * Markdown as email HTML. HTML typed into the Markdown is shown as text, not rendered (R41), and
 * links and images must be web or mail addresses.
 */
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens)
      if (!SAFE_LINK.test(href)) return inner
      const titled = title ? ` title="${escapeHtml(title)}"` : ""
      return `<a href="${escapeHtml(href)}"${titled} style="color:#111111;text-decoration:underline">${inner}</a>`
    },
    image({ href, text }) {
      if (!/^https:/i.test(href)) return escapeHtml(text)
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" style="max-width:100%;height:auto;border:0">`
    },
  },
})

const layout = (props: {
  readonly subject: string
  readonly previewText: string
  readonly body: string
  readonly footer: string
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(props.subject)}</title>
<style>
  body { margin: 0; padding: 0; background: #f4f4f4; }
  .content p, .content li { font-size: 16px; line-height: 1.55; }
  .content h1 { font-size: 24px; line-height: 1.3; margin: 0 0 16px; }
  .content h2 { font-size: 20px; line-height: 1.35; margin: 24px 0 12px; }
  .content h3 { font-size: 17px; line-height: 1.4; margin: 20px 0 8px; }
  .content blockquote { margin: 0 0 16px; padding-left: 14px; border-left: 3px solid #dddddd; color: #555555; }
  .content code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: #f1f1f1; padding: 1px 4px; border-radius: 3px; }
  .content hr { border: 0; border-top: 1px solid #e5e5e5; margin: 24px 0; }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(props.previewText)}&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px">
<tr><td class="content" style="padding:32px 32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111111">
${props.body}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:20px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#777777;text-align:center">
${props.footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

/**
 * A campaign as one recipient gets it (R40, R41): subject, HTML with the footer, and a plain-text
 * part. Pure, so the preview, test sends and real sends all render the same way.
 */
export const renderEmail = (
  content: { readonly subject: string; readonly previewText: string; readonly body: string },
  values: MergeValues,
  footer: Footer,
): RenderedEmail => {
  const unknown = new Set<string>()
  const plain = (value: string) => value
  const subject = fill(content.subject, values, plain, unknown).replace(/\s+/g, " ").trim()
  const previewText = fill(content.previewText, values, plain, unknown).trim()
  // Tags become inert placeholders before Markdown runs, and their values go in afterwards, escaped.
  // Filling them into the HTML directly would let a fallback reach across tags and into attributes.
  const nonce = crypto.randomUUID().replaceAll("-", "").slice(0, 10)
  const tags: Array<string> = []
  const marked = content.body.replace(TAG, (whole) => `mt${nonce}x${tags.push(whole) - 1}x`)
  const bodyHtml = markdown
    .parse(marked, { async: false })
    .replace(new RegExp(`mt${nonce}x(\\d+)x`, "g"), (_, index: string) =>
      fill(tags[Number(index)] ?? "", values, escapeHtml, unknown),
    )
  const bodyText = fill(content.body, values, plain, unknown).trim()

  const link = footer.unsubscribeUrl
  const footerHtml = [
    `<p style="margin:0 0 6px">${escapeHtml(footer.reason)}</p>`,
    `<p style="margin:0 0 6px">${escapeHtml(footer.legalName)} · ${escapeHtml(footer.postalAddress)}</p>`,
    `<p style="margin:0"><a href="${escapeHtml(link ?? "#")}" style="color:#777777;text-decoration:underline">Unsubscribe</a> or choose which email you get.</p>`,
  ].join("\n")
  const footerText = [
    "—",
    footer.reason,
    `${footer.legalName} · ${footer.postalAddress}`,
    `Unsubscribe or choose which email you get: ${link ?? "(your unsubscribe link)"}`,
  ].join("\n")

  return {
    subject,
    previewText,
    html: layout({ subject, previewText, body: bodyHtml, footer: footerHtml }),
    text: `${bodyText}\n\n${footerText}\n`,
    unknownMergeTags: [...unknown],
  }
}
