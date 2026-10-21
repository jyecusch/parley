import { type EmailStyle, PLAIN_COLORS, type RenderedEmail } from "@parley/domain"
import { Marked } from "marked"
import sanitizeHtml from "sanitize-html"

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

/** The footer every broadcast email ends with (R40). Null link: a preview, which has none yet. */
export interface Footer {
  readonly legalName: string
  readonly postalAddress: string
  readonly reason: string
  readonly unsubscribeUrl: string | null
}

/** What the renderer needs from an email style (D116): the look, with the logo as a public address. */
export type RenderStyle = Pick<
  EmailStyle,
  "layout" | "logoUrl" | "logoAlign" | "headerText" | "footerAlign" | "colors" | "font" | "customHtml"
>

/** The plain look (D115): like a personal email. Used when no style is given. */
export const PLAIN_STYLE: RenderStyle = {
  layout: "plain",
  logoUrl: null,
  logoAlign: "left",
  headerText: null,
  footerAlign: "left",
  colors: PLAIN_COLORS,
  font: "default",
  customHtml: null,
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
/** A logo is served by Parley, which in development is plain http; everything a person types must be https. */
const SAFE_LOGO = /^https?:\/\//i

/** The font stacks behind a style's font (D116). "default" sets none, so the reader's own font shows. */
const FONT_STACKS: Readonly<Record<RenderStyle["font"], string | null>> = {
  sans: "Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  default: null,
}

/** A colour from a style, re-checked so nothing but a hex colour ever reaches a style attribute. */
const colorOf = (value: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback)

const FOOTER_GREY = "#767676"

/**
 * A button written on its own line (D118): `[[button: See what's new | https://example.com]]`.
 * The label is plain words; the address must be https or mailto.
 */
const BUTTON = /^[ \t]*\[\[button:[ \t]*([^|\]\n]{1,120}?)[ \t]*\|[ \t]*(\S+?)[ \t]*\]\][ \t]*$/gm

/**
 * Markdown as email HTML, in a style's colours. HTML typed into the Markdown is shown as text, not
 * rendered (R41); links must be web or mail addresses, and images https.
 */
const markdownFor = (link: string) =>
  new Marked({
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
        return `<a href="${escapeHtml(href)}"${titled} style="color:${link};text-decoration:underline">${inner}</a>`
      },
      image({ href, text }) {
        if (!/^https:/i.test(href)) return escapeHtml(text)
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" style="display:block;max-width:100%;height:auto;border:0;margin:8px 0">`
      },
      hr() {
        return `<hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0">\n`
      },
    },
  })

/** A button that looks the same in every email app, Outlook included: a table cell, not a styled link alone. */
const buttonHtml = (label: string, href: string, colors: RenderStyle["colors"]) => {
  const background = colorOf(colors.button, PLAIN_COLORS.button)
  const text = colorOf(colors.buttonText, PLAIN_COLORS.buttonText)
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="border-radius:6px;background:${background}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;line-height:1.2;color:${text};text-decoration:none;border-radius:6px">${escapeHtml(label)}</a></td></tr></table>`
}

const STYLE_SHEET = `
  .content p, .content li { font-size: 16px; line-height: 1.55; }
  .content p { margin: 0 0 16px; }
  .content h1 { font-size: 24px; line-height: 1.3; margin: 0 0 16px; }
  .content h2 { font-size: 20px; line-height: 1.35; margin: 24px 0 12px; }
  .content h3 { font-size: 17px; line-height: 1.4; margin: 20px 0 8px; }
  .content blockquote { margin: 0 0 16px; padding-left: 14px; border-left: 3px solid #dddddd; color: #555555; }
  .content code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: #f1f1f1; padding: 1px 4px; border-radius: 3px; }`

/** The logo and header line at the top of plain and card emails, or nothing. */
const headerHtml = (style: RenderStyle, divider: boolean) => {
  const logo =
    style.logoUrl && SAFE_LOGO.test(style.logoUrl)
      ? `<img src="${escapeHtml(style.logoUrl)}" alt="" height="40" style="display:inline-block;height:40px;max-height:48px;width:auto;border:0;vertical-align:middle">`
      : ""
  const line = style.headerText?.trim()
    ? `<span style="display:inline-block;vertical-align:middle;font-size:14px;color:${FOOTER_GREY};${logo ? "margin-left:12px" : ""}">${escapeHtml(style.headerText.trim())}</span>`
    : ""
  if (!logo && !line) return ""
  const align = style.logoAlign === "center" ? "center" : "left"
  const rule = divider ? "border-bottom:1px solid #e6e6e6;padding-bottom:16px;" : ""
  return `<tr><td style="${rule}padding-top:0;margin:0;text-align:${align}">${logo}${line}</td></tr>
<tr><td style="height:20px;line-height:20px;font-size:0">&nbsp;</td></tr>`
}

const documentHtml = (props: {
  readonly subject: string
  readonly previewText: string
  readonly background: string
  readonly inner: string
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(props.subject)}</title>
<style>${STYLE_SHEET}
</style>
</head>
<body style="margin:0;padding:0;background:${props.background}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(props.previewText)}&#847;&zwnj;&nbsp;</div>
${props.inner}
</body>
</html>`

interface Parts {
  readonly subject: string
  readonly previewText: string
  readonly body: string
  readonly footer: string
}

/** Text colour and font for a cell, as a style attribute's contents. */
const typeOf = (style: RenderStyle) => {
  const stack = FONT_STACKS[style.font]
  return `${stack ? `font-family:${stack};` : ""}color:${colorOf(style.colors.text, PLAIN_COLORS.text)}`
}

const FOOTER_ALIGNS = new Set(["left", "center", "right"])

/**
 * The footer as it sits under the content, inside the same column or card (D121): a thin rule, then
 * small grey lines, aligned as the style says. The font follows the style, or inherits for custom HTML.
 */
const footerBlock = (footer: string, style: RenderStyle, font: "style" | "inherit") => {
  const align = FOOTER_ALIGNS.has(style.footerAlign) ? style.footerAlign : "left"
  const stack = font === "style" ? FONT_STACKS[style.font] : undefined
  return `<div style="border-top:1px solid #e5e5e5;margin-top:16px;padding-top:12px;${stack ? `font-family:${stack};` : ""}font-size:12px;line-height:1.6;color:${FOOTER_GREY};text-align:${align}">
${footer}
</div>`
}

/** Plain (D115): like a personal email. Left-aligned, no card; a thin rule, then the footer in small grey text. */
const plainLayout = (parts: Parts, style: RenderStyle) =>
  documentHtml({
    subject: parts.subject,
    previewText: parts.previewText,
    background: colorOf(style.colors.background, PLAIN_COLORS.background),
    inner: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colorOf(style.colors.background, PLAIN_COLORS.background)}">
<tr><td style="padding:24px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
${headerHtml(style, false)}<tr><td class="content" style="${typeOf(style)}">
${parts.body}
</td></tr>
<tr><td>${footerBlock(parts.footer, style, "style")}</td></tr>
</table>
</td></tr>
</table>`,
  })

/** Card: the content on a white card, full width up to 600px, over the background colour; the footer inside the card, under the content. */
const cardLayout = (parts: Parts, style: RenderStyle) => {
  const background = colorOf(style.colors.background, "#F4F4F4")
  return documentHtml({
    subject: parts.subject,
    previewText: parts.previewText,
    background,
    inner: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${background}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px">
<tr><td style="padding:32px 32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${headerHtml(style, true)}<tr><td class="content" style="${typeOf(style)}">
${parts.body}
</td></tr>
<tr><td style="padding-bottom:16px">${footerBlock(parts.footer, style, "style")}</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>`,
  })
}

/** Where a custom layout puts the email's body. */
export const CONTENT_SLOT = /\{\{\s*content\s*\}\}/

/**
 * Custom HTML made safe for email: no scripts, frames, embeds or forms, no event handlers, and only
 * web and mail addresses. Layout markup, inline styles and <style> blocks stay. Merge tags aren't
 * filled here; only {{content}} means anything.
 */
export const sanitizeCustomHtml = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: [
      "a",
      "abbr",
      "address",
      "article",
      "aside",
      "b",
      "big",
      "blockquote",
      "br",
      "caption",
      "center",
      "cite",
      "code",
      "col",
      "colgroup",
      "dd",
      "del",
      "div",
      "dl",
      "dt",
      "em",
      "figcaption",
      "figure",
      "font",
      "footer",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "header",
      "hr",
      "i",
      "img",
      "ins",
      "li",
      "main",
      "mark",
      "nav",
      "ol",
      "p",
      "pre",
      "q",
      "s",
      "section",
      "small",
      "span",
      "strike",
      "strong",
      "style",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
    ],
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "id",
        "align",
        "valign",
        "width",
        "height",
        "bgcolor",
        "border",
        "dir",
        "lang",
        "title",
        "role",
      ],
      a: ["href", "target", "rel", "name"],
      img: ["src", "alt"],
      table: ["cellpadding", "cellspacing", "background"],
      td: ["colspan", "rowspan", "background"],
      th: ["colspan", "rowspan", "scope"],
      font: ["color", "face", "size"],
      col: ["span"],
      colgroup: ["span"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    // <style> is needed for email layouts; its contents are CSS, which can't run script in email apps.
    allowVulnerableTags: true,
    // A whole document's <title> and <head> contents are dropped rather than shown as text.
    nonTextTags: ["script", "textarea", "option", "noscript", "title", "head"],
  })

/** Where a custom layout may put Parley's footer. Without it, the footer follows the body in the same element. */
export const FOOTER_SLOT = /\{\{\s*footer\s*\}\}/

/**
 * Custom: the team's own HTML around the body (D116). Parley's footer is always included: at
 * {{footer}} when the HTML has one, else straight after the body inside the same element, so it
 * shares the content's width (D121).
 */
const customLayout = (parts: Parts, style: RenderStyle) => {
  const safe = sanitizeCustomHtml(style.customHtml ?? "{{content}}")
  const footer = footerBlock(parts.footer, style, "inherit")
  const hasFooterSlot = FOOTER_SLOT.test(safe)
  const body = `<div class="content">${parts.body}</div>${hasFooterSlot ? "" : footer}`
  const withBody = CONTENT_SLOT.test(safe) ? safe.replace(CONTENT_SLOT, () => body) : `${safe}${body}`
  return documentHtml({
    subject: parts.subject,
    previewText: parts.previewText,
    background: "#ffffff",
    inner: hasFooterSlot ? withBody.replace(FOOTER_SLOT, () => footer) : withBody,
  })
}

/** A button line in the plain-text part: "Label: address". */
const plainTextOf = (body: string) =>
  body
    .replace(BUTTON, (_, label: string, href: string) => `${label.trim()}: ${href}`)
    .replace(/!\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, (_, alt: string) => `[${alt}]`)

/**
 * A broadcast as one recipient gets it (R40, R41): subject, HTML with the footer, and a plain-text
 * part, in an email style (D116). Pure, so the preview, test sends and real sends all render the
 * same way.
 */
export const renderEmail = (
  content: { readonly subject: string; readonly previewText: string; readonly body: string },
  values: MergeValues,
  footer: Footer,
  style: RenderStyle = PLAIN_STYLE,
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
  // Buttons become placeholder paragraphs too, so Markdown leaves them alone; unsafe addresses stay as typed text.
  const buttons: Array<string> = []
  const withButtons = marked.replace(BUTTON, (whole, label: string, href: string) =>
    SAFE_LINK.test(href) && !/^http:/i.test(href)
      ? `\n\nbt${nonce}x${buttons.push(buttonHtml(label.trim(), href, style.colors)) - 1}x\n\n`
      : whole,
  )
  const link = colorOf(style.colors.link, PLAIN_COLORS.link)
  const bodyHtml = markdownFor(link)
    .parse(withButtons, { async: false })
    .replace(new RegExp(`<p>bt${nonce}x(\\d+)x</p>`, "g"), (_, index: string) => buttons[Number(index)] ?? "")
    .replace(new RegExp(`mt${nonce}x(\\d+)x`, "g"), (_, index: string) =>
      fill(tags[Number(index)] ?? "", values, escapeHtml, unknown),
    )
  const bodyText = fill(plainTextOf(content.body), values, plain, unknown).trim()

  const unsubscribe = footer.unsubscribeUrl
  const footerHtml = [
    `<p style="margin:0 0 6px">${escapeHtml(footer.reason)}</p>`,
    `<p style="margin:0 0 6px">${escapeHtml(footer.legalName)} · ${escapeHtml(footer.postalAddress)}</p>`,
    `<p style="margin:0"><a href="${escapeHtml(unsubscribe ?? "#")}" style="color:${FOOTER_GREY};text-decoration:underline">Unsubscribe</a> or choose which email you get.</p>`,
  ].join("\n")
  const footerText = [
    "—",
    footer.reason,
    `${footer.legalName} · ${footer.postalAddress}`,
    `Unsubscribe or choose which email you get: ${unsubscribe ?? "(your unsubscribe link)"}`,
  ].join("\n")

  const parts = { subject, previewText, body: bodyHtml, footer: footerHtml }
  const html =
    style.layout === "custom"
      ? customLayout(parts, style)
      : style.layout === "card"
        ? cardLayout(parts, style)
        : plainLayout(parts, style)
  return {
    subject,
    previewText,
    html,
    text: `${bodyText}\n\n${footerText}\n`,
    unknownMergeTags: [...unknown],
  }
}
