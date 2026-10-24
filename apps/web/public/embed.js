/*
 * Parley forms: the embed script (D144).
 *
 *   <script src="https://app.parley.page/embed.js" data-parley-form="FORM_ID" async></script>
 *
 * Puts the form in an iframe right after the script tag (or inside data-parley-target, a CSS
 * selector), sizes it to fit, and passes along the page's address and its utm_* parameters.
 * Optional:
 *   data-appearance='{"colors":{"accent":"#0a7a5c"}}'
 *
 * Tracking options (D154). Both are off unless the site turns them on, since the site decides what
 * its visitors consent to:
 *   data-remember-utm       Remembers UTM parameters for the visit, so a sign-up on another page
 *                           still has them. ="30" remembers them for 30 days. Stored in the
 *                           site's own sessionStorage (for the visit) or localStorage (for days).
 *                           Add the script to every page, with or without a form, to catch the
 *                           landing page: <script src=".../embed.js" data-remember-utm async></script>
 *   data-click-ids          Passes ad click IDs too: gclid, gbraid, wbraid (Google Ads), fbclid
 *                           (Meta), msclkid (Microsoft Ads), li_fat_id (LinkedIn), ttclid (TikTok)
 *                           and twclid (X). Remembered with the UTMs when both are on.
 * They apply to the whole page, from whichever Parley script tag has them.
 *
 * Or from JavaScript, once this script has loaded:
 *   Parley.form("#signup", { form: "FORM_ID", appearance: {...}, onSubmit: function () {} })
 *
 * The form runs on Parley's own domain: the page can't read what visitors type, and the form
 * can only tell the page its height, that it was submitted, or where to go next.
 */
;(() => {
  // Loaded more than once (one script tag per form): the first copy mounts any new tags.
  if (window.Parley?.scan) {
    window.Parley.scan()
    return
  }

  const script = document.currentScript
  const origin = script ? new URL(script.src).origin : "https://app.parley.page"
  const frames = [] // { iframe, formId, onSubmit }

  const UTM = /^utm_[a-z][a-z_]{0,39}$/
  const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "li_fat_id", "ttclid", "twclid"]
  const STORE = "parley.tracking"

  /** A tracking option's value from any Parley script tag on the page, or null when it's off. */
  function option(name) {
    const tag = document.querySelector(`script[data-${name}]`)
    return tag ? tag.getAttribute(`data-${name}`) : null
  }

  /**
   * The tracking parameters to pass (D153, D154): this page's, or, with data-remember-utm, the
   * last ones remembered. New ones replace remembered ones, so the latest campaign counts.
   */
  function tracking() {
    const withClickIds = option("click-ids") !== null
    const remember = option("remember-utm")
    const current = { utm: {}, clickIds: {} }
    new URLSearchParams(location.search).forEach((value, key) => {
      if (!value) return
      if (UTM.test(key)) current.utm[key] = value.slice(0, 500)
      else if (withClickIds && CLICK_IDS.indexOf(key) >= 0) current.clickIds[key] = value.slice(0, 500)
    })
    if (remember === null) return current
    const days = Math.min(Number(remember) || 0, 365)
    const found = Object.keys(current.utm).length > 0 || Object.keys(current.clickIds).length > 0
    try {
      // Storage can be blocked (private windows, strict settings); then only this page's count.
      const storage = days > 0 ? window.localStorage : window.sessionStorage
      if (found) {
        storage.setItem(STORE, JSON.stringify({ ...current, expires: days > 0 ? Date.now() + days * 86400000 : null }))
        return current
      }
      const saved = JSON.parse(storage.getItem(STORE) || "null")
      if (saved && (!saved.expires || saved.expires > Date.now())) {
        return { utm: saved.utm || {}, clickIds: withClickIds ? saved.clickIds || {} : {} }
      }
    } catch (_) {}
    return current
  }
  // Remembered as the page loads, so a landing page without a form counts too.
  const passed = tracking()

  /** The form page's address: the form, this page, its tracking parameters and any appearance overrides. */
  function frameUrl(formId, appearance) {
    const url = new URL(`/f/${encodeURIComponent(formId)}`, origin)
    url.searchParams.set("page", location.href.slice(0, 2000))
    for (const key in passed.utm) url.searchParams.set(key, passed.utm[key])
    for (const key in passed.clickIds) url.searchParams.set(key, passed.clickIds[key])
    if (appearance) {
      url.searchParams.set("appearance", typeof appearance === "string" ? appearance : JSON.stringify(appearance))
    }
    return url.toString()
  }

  function mount(target, options) {
    const iframe = document.createElement("iframe")
    iframe.src = frameUrl(options.form, options.appearance)
    iframe.title = options.title || "Sign-up form"
    iframe.loading = "lazy"
    iframe.style.cssText = "display:block;width:100%;height:400px;border:0;background:transparent;overflow:hidden"
    iframe.setAttribute("allowtransparency", "true")
    if (options.after) target.parentNode.insertBefore(iframe, target.nextSibling)
    else target.appendChild(iframe)
    frames.push({ iframe: iframe, formId: options.form, onSubmit: options.onSubmit })
    return iframe
  }

  // Messages come only from Parley's own form pages, and only from frames this script made.
  window.addEventListener("message", (event) => {
    if (event.origin !== origin || !event.data || typeof event.data.type !== "string") return
    const entry = frames.find((frame) => frame.iframe.contentWindow === event.source)
    if (!entry) return
    const data = event.data
    if (data.type === "parley:resize" && typeof data.height === "number" && data.height > 0) {
      entry.iframe.style.height = `${Math.min(Math.ceil(data.height) + 2, 4000)}px`
    } else if (data.type === "parley:submitted") {
      if (typeof entry.onSubmit === "function") entry.onSubmit({ form: entry.formId })
    } else if (data.type === "parley:redirect" && typeof data.url === "string" && data.url.indexOf("https://") === 0) {
      window.location.assign(data.url)
    }
  })

  window.Parley = {
    /** Puts a form into `target` (an element or a CSS selector). */
    form: (target, options) => {
      const element = typeof target === "string" ? document.querySelector(target) : target
      if (!element || !options?.form) throw new Error("Parley.form needs a target element and { form }")
      return mount(element, options)
    },
  }

  /** Mounts every script tag's form not mounted yet. */
  function scan() {
    document.querySelectorAll("script[data-parley-form]").forEach((tag) => {
      if (tag.dataset.parleyMounted) return
      tag.dataset.parleyMounted = "true"
      const targetSelector = tag.dataset.parleyTarget
      const target = targetSelector ? document.querySelector(targetSelector) : tag
      if (!target) return
      mount(target, {
        form: tag.dataset.parleyForm,
        appearance: tag.dataset.appearance,
        title: tag.dataset.parleyTitle,
        after: !targetSelector,
      })
    })
  }
  window.Parley.scan = scan
  scan()
})()
