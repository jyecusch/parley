import { useEffect, useRef } from "react"

/** Elements an email preview never needs, and that could run code or reach outside the preview. */
const DROP = "script, iframe, frame, object, embed, link, meta, base, form, input, button, textarea, select"
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "srcset", "background"])

/**
 * An email's HTML, shown in a shadow root rather than an iframe. An iframe is a separate document, and
 * CRT mode's HTML-in-canvas only draws the app's own document, so an iframe shows blank there. The shadow
 * root keeps the email's styles and the app's apart. Without an iframe's sandbox, the HTML is cleaned
 * first: no scripts, no event handlers, no javascript: links. (Parley's renderer already escapes what
 * people type; this is the second line.)
 */
export function EmailPreview(props: { readonly html: string; readonly label: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" })
    // Parsing into a separate document runs nothing and loads nothing.
    const parsed = new DOMParser().parseFromString(props.html, "text/html")
    for (const node of parsed.querySelectorAll(DROP)) node.remove()
    for (const node of parsed.querySelectorAll("*")) {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase()
        const unsafeUrl = URL_ATTRIBUTES.has(name) && /^\s*(javascript|data|vbscript):/i.test(attribute.value)
        if (name.startsWith("on") || unsafeUrl) {
          node.removeAttribute(attribute.name)
        }
      }
      // Links open on their own, never in place of the app.
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank")
        node.setAttribute("rel", "noopener noreferrer")
      }
    }
    // The email's own styles target `body`; inside the shadow root its body is a wrapper div.
    const css = [...parsed.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n")
    for (const style of parsed.querySelectorAll("style")) style.remove()
    const style = document.createElement("style")
    style.textContent = `:host { display: block; overflow: auto; color: #111111; color-scheme: light; }
.email-body { margin: 0; background: #f4f4f4; min-height: 100%; }
${css.replace(/(^|[\s,}])body\b/g, "$1.email-body")}`
    const body = document.createElement("div")
    body.className = "email-body"
    body.append(...parsed.body.childNodes)
    root.replaceChildren(style, body)
  }, [props.html])

  return <div ref={host} className="cmp-frame" role="document" aria-label={props.label} />
}
