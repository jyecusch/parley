import DOMPurify from "dompurify"
import { useEffect, useRef } from "react"

/** CSS that could load something or escape the preview: imports, remote images and old IE scripting. */
const UNSAFE_CSS = /@import|url\s*\(|expression\s*\(|behavio(u)?r\s*:|-moz-binding/i

/**
 * An email's HTML, shown in a shadow root rather than an iframe. An iframe is a separate document, and
 * CRT mode's HTML-in-canvas only draws the app's own document, so an iframe shows blank there. The shadow
 * root keeps the email's styles and the app's apart.
 *
 * Without an iframe's sandbox, the HTML is cleaned with DOMPurify's HTML-only allowlist (no SVG or
 * MathML, no scripts, handlers or script URLs), CSS that could load anything is dropped, and the
 * host contains layout and paint, so even `position: fixed` stays inside the preview. Parley's
 * renderer already escapes what people type; this is the second line.
 */
export function EmailPreview(props: { readonly html: string; readonly label: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" })
    // The email's <style> rules, without anything that could load a resource.
    const parsed = new DOMParser().parseFromString(props.html, "text/html")
    const css = [...parsed.querySelectorAll("style")]
      .map((style) => style.textContent ?? "")
      .filter((text) => !UNSAFE_CSS.test(text))
      .join("\n")
    const body = DOMPurify.sanitize(parsed.body.innerHTML, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
      ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
      RETURN_DOM_FRAGMENT: true,
    })
    for (const node of body.querySelectorAll("[style]")) {
      if (UNSAFE_CSS.test(node.getAttribute("style") ?? "")) node.removeAttribute("style")
    }
    // Links open on their own, never in place of the app.
    for (const link of body.querySelectorAll("a")) {
      link.setAttribute("target", "_blank")
      link.setAttribute("rel", "noopener noreferrer")
    }
    const style = document.createElement("style")
    style.textContent = `:host { display: block; overflow: auto; contain: layout paint; color: #111111; color-scheme: light; }
.email-body { margin: 0; background: #f4f4f4; min-height: 100%; }
${css.replace(/(^|[\s,}])body\b/g, "$1.email-body")}`
    const wrapper = document.createElement("div")
    wrapper.className = "email-body"
    wrapper.append(body)
    root.replaceChildren(style, wrapper)
  }, [props.html])

  return <div ref={host} className="cmp-frame" role="document" aria-label={props.label} />
}
