import { describe, expect, it } from "@effect/vitest"
import { PLAIN_STYLE, type RenderStyle, renderEmail, SAMPLE_VALUES } from "../src/email/render.ts"

const footer = {
  legalName: "Acme Pty Ltd",
  postalAddress: "1 Market St",
  reason: "Because.",
  unsubscribeUrl: "https://x/u",
}
const render = (body: string, values = SAMPLE_VALUES) =>
  renderEmail({ subject: "Hi", previewText: "", body }, values, footer)

describe("email rendering", () => {
  it("fills merge tags into text and links without letting them reach into markup", () => {
    const html = render("Hi **{{first_name|there}}**, see [our site](https://acme.com/?for={{email}}).").html
    expect(html).toContain("<strong>Sam</strong>")
    expect(html).toContain('href="https://acme.com/?for=sam@example.com"')
  })

  it("keeps a fallback from breaking out of a link", () => {
    const html = render(
      "[T](https://x.com/{{name|) zz }}\n\n[b](<https://y.com/ onmouseover=alert(1) style=position:fixed;inset:0 >)",
    ).html
    // Every link has only the attributes the renderer writes; anything else stays inside a quoted href.
    for (const tag of html.match(/<a [^>]*>/g) ?? []) {
      expect(tag).toMatch(/^<a href="[^"]*"( title="[^"]*")? style="[^"]*">$/)
    }
    // The footer, with the unsubscribe link, always survives.
    expect(html).toContain('href="https://x/u"')
  })

  it("escapes values that look like markup", () => {
    const html = render("Hello {{name}}", { ...SAMPLE_VALUES, name: '<img src=x onerror="alert(1)">' }).html
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
  })

  it("shows unknown tags as typed, escaped", () => {
    const rendered = render("{{favorite}} <b>x</b>")
    expect(rendered.unknownMergeTags).toEqual(["favorite"])
    expect(rendered.html).not.toContain("<b>")
  })
})

const styled = (body: string, style: Partial<RenderStyle>) =>
  renderEmail({ subject: "Hi", previewText: "", body }, SAMPLE_VALUES, footer, { ...PLAIN_STYLE, ...style })

describe("email styles", () => {
  it("renders the plain look by default: no card, the reader's font, a rule, then the footer", () => {
    const html = render("Hello").html
    expect(html).not.toContain("border-radius:8px")
    expect(html).not.toMatch(/class="content" style="font-family/)
    expect(html).toContain("border-top:1px solid #e5e5e5")
    expect(html).toContain("Acme Pty Ltd · 1 Market St")
    // The unsubscribe link is the footer's gray.
    expect(html).toContain('style="color:#767676;text-decoration:underline">Unsubscribe</a>')
  })

  it("renders a card at full width, up to 600px, on the background color", () => {
    const html = styled("Hello", { layout: "card", colors: { ...PLAIN_STYLE.colors, background: "#EEF1F6" } }).html
    expect(html).toContain(
      'width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff',
    )
    expect(html).toContain("background:#EEF1F6")
  })

  it("puts the logo and header line at the top, and uses the style's colors and font", () => {
    const html = styled("See [this](https://acme.com)", {
      logoUrl: "https://parley.example/i/abc",
      logoAlign: "center",
      headerText: "The Acme newsletter",
      font: "serif",
      colors: { ...PLAIN_STYLE.colors, text: "#1F2430", link: "#2F5BEA" },
    }).html
    expect(html).toContain('<img src="https://parley.example/i/abc" alt=""')
    expect(html).toContain("text-align:center")
    expect(html).toContain("The Acme newsletter")
    expect(html).toContain("font-family:Georgia, 'Times New Roman', serif;color:#1F2430")
    expect(html).toContain('style="color:#2F5BEA;text-decoration:underline"')
  })

  it("never lets a color or logo address break out of its attribute", () => {
    const html = styled("Hi", {
      logoUrl: "javascript:alert(1)",
      colors: { ...PLAIN_STYLE.colors, text: '#000;"><script>alert(1)</script>' },
    }).html
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("<script>")
  })

  it("draws buttons and images, and refuses unsafe addresses", () => {
    const rendered = styled(
      "[[button: See what's new | https://acme.com/new]]\n\n[[button: Bad | javascript:alert(1)]]\n\n![Chart](https://acme.com/chart.png)\n\n![Old](http://acme.com/old.png)\n\n---",
      { colors: { ...PLAIN_STYLE.colors, button: "#2F5BEA", buttonText: "#FFFFFF" } },
    )
    expect(rendered.html).toContain('<td style="border-radius:6px;background:#2F5BEA"><a href="https://acme.com/new"')
    expect(rendered.html).toContain("See what&#39;s new</a>")
    expect(rendered.html).not.toContain('href="javascript:')
    expect(rendered.html).toContain(
      '<img src="https://acme.com/chart.png" alt="Chart" style="display:block;max-width:100%',
    )
    expect(rendered.html).not.toContain('src="http://acme.com/old.png"')
    expect(rendered.html).toContain("<hr style=")
    expect(rendered.text).toContain("See what's new: https://acme.com/new")
    expect(rendered.text).toContain("[Chart]")
  })

  it("sanitizes custom HTML, puts the body in {{content}}, and always adds the footer", () => {
    const html = styled("Hello **there**", {
      layout: "custom",
      customHtml:
        '<div style="background:#000"><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe><form><input></form>{{content}}</div>',
    }).html
    for (const unsafe of ["<script", "onerror", "javascript:", "<iframe", "<form", "<input"]) {
      expect(html).not.toContain(unsafe)
    }
    expect(html).toContain('<div class="content"><p>Hello <strong>there</strong></p>')
    expect(html).toContain('href="https://x/u"')
    expect(html.indexOf("Acme Pty Ltd")).toBeGreaterThan(html.indexOf("Hello"))
  })

  it("keeps the footer inside the content's column or card, aligned as the style says", () => {
    for (const layout of ["plain", "card"] as const) {
      const html = styled("Hello", { layout, footerAlign: "right" }).html
      expect(html).toContain("text-align:right")
      // The footer comes before the content's container closes: nothing between them but its own markup.
      const footerAt = html.indexOf("Acme Pty Ltd")
      const contentAt = html.indexOf('class="content"')
      expect(footerAt).toBeGreaterThan(contentAt)
      expect(html.slice(contentAt, footerAt)).not.toContain('max-width:600px">')
    }
    expect(styled("Hello", { footerAlign: "center" }).html).toContain("text-align:center")
  })

  it("puts custom HTML's footer right after the body in the same element, or at {{footer}}", () => {
    const sameElement = styled("Hello", {
      layout: "custom",
      customHtml: '<div id="box">{{content}}</div><p id="after">after</p>',
    }).html
    expect(sameElement.indexOf("Acme Pty Ltd")).toBeLessThan(sameElement.indexOf('id="after"'))
    expect(sameElement.indexOf("Acme Pty Ltd")).toBeGreaterThan(sameElement.indexOf("Hello"))

    const slotted = styled("Hello", {
      layout: "custom",
      customHtml: '<table><tr><td>{{content}}</td></tr><tr><td id="foot">{{footer}}</td></tr></table>',
    }).html
    expect(slotted.indexOf("Acme Pty Ltd")).toBeGreaterThan(slotted.indexOf('id="foot"'))
    expect(slotted).not.toContain("{{footer}}")
    expect(slotted.match(/Acme Pty Ltd/g)?.length).toBe(1)
  })
})
