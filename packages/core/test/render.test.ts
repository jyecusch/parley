import { describe, expect, it } from "@effect/vitest"
import { renderEmail, SAMPLE_VALUES } from "../src/email/render.ts"

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
    const rendered = render("{{favourite}} <b>x</b>")
    expect(rendered.unknownMergeTags).toEqual(["favourite"])
    expect(rendered.html).not.toContain("<b>")
  })
})
