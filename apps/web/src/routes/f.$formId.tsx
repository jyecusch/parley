import { Turnstile } from "@marsidev/react-turnstile"
import type { RenderedForm, SubmissionOutcome } from "@parley/core"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { type FormValues, FormView } from "../components/form-view.tsx"
import { solveProofOfWork } from "../lib/forms-captcha.ts"
import { checkAnswers, embedContextOf, isEmbedded, reportHeight, tellParent } from "../lib/forms-page.ts"

/*
 * A published form, as visitors see it (D144): inside an iframe on a team's site (embed.js puts it
 * there) or on its own as the hosted page. No app chrome; only the form's own appearance. The
 * built-in proof of work starts solving as soon as the form loads, so it's done before anyone
 * finishes typing (D147).
 */
export const Route = createFileRoute("/f/$formId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign up" }, { name: "robots", content: "noindex" }] }),
  component: FormPage,
})

/** The page's own look: nothing but the form, on a transparent background. */
// color-scheme matches the host page's default: a frame whose scheme differs (the app's dark one)
// gets an opaque backdrop from the browser, which shows behind rounded corners.
const PAGE_CSS = `:root{color-scheme:normal!important}
html,body{margin:0;padding:0;background:transparent!important;min-height:0}
body::before,body::after{display:none!important}
.FormPage{padding:4px}`

function FormPage() {
  const { formId } = Route.useParams()
  const [values, setValues] = useState<FormValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  /** Bumped after a failed try: a render token is good for one submission, so the form loads again. */
  const [tries, setTries] = useState(0)
  const solution = useRef<Promise<string> | undefined>(undefined)
  const turnstileToken = useRef("")
  const frame = useRef<HTMLDivElement>(null)
  const context = useRef(typeof window === "undefined" ? undefined : embedContextOf(window.location.search))
  const embedded = isEmbedded()

  // This page runs on Parley's domain, so the app's own appearance settings would apply; they mustn't.
  useEffect(() => {
    delete document.documentElement.dataset.crt
  }, [])

  /** The form with a fresh render token and captcha; null when there's no such form. */
  const loaded = useQuery({
    queryKey: ["public-form", formId, tries],
    queryFn: async (): Promise<RenderedForm | null> => {
      const query = new URLSearchParams()
      if (context.current?.page) query.set("page", context.current.page)
      // Loading again for a fresh token after a failed try isn't another view.
      if (tries > 0) query.set("again", "1")
      if (context.current?.appearance) query.set("appearance", context.current.appearance)
      const response = await fetch(`/api/forms/${encodeURIComponent(formId)}?${query}`, {
        headers: { accept: "application/json" },
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`form didn't load: ${response.status}`)
      return (await response.json()) as RenderedForm
    },
    // A token is used once: never refetched behind the visitor's back, never kept for later.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    placeholderData: keepPreviousData,
  })
  const form = loaded.data ?? undefined

  // The proof of work starts as soon as the form is in, so it's done before anyone finishes typing.
  useEffect(() => {
    if (!form) return
    solution.current = form.captcha.provider === "builtin" ? solveProofOfWork(form.captcha.challenge) : undefined
    document.title = form.content.title || "Sign up"
  }, [form])

  const turnstile = form?.captcha.provider === "turnstile" ? form.captcha : undefined

  useEffect(() => (frame.current ? reportHeight(formId, frame.current) : undefined), [formId])

  const submit = async () => {
    if (!form) return
    const problems = checkAnswers(form.content, form.customFields, values)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    setBusy(true)
    const { _website, ...answers } = values
    const captchaToken =
      form.captcha.provider === "builtin" ? ((await solution.current?.catch(() => "")) ?? "") : turnstileToken.current
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(formId)}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          renderToken: form.renderToken,
          values: answers,
          honeypot: typeof _website === "string" ? _website : "",
          captchaToken,
          page: context.current?.page ?? "",
          utm: form.content.captureTracking ? (context.current?.utm ?? {}) : {},
          clickIds: form.content.captureTracking ? (context.current?.clickIds ?? {}) : {},
        }),
      })
      const outcome = (await response.json().catch(() => ({ kind: "unavailable" }))) as SubmissionOutcome
      if (outcome.kind === "accepted") {
        tellParent({ type: "parley:submitted", formId })
        if (outcome.afterSubmit.kind === "redirect") {
          // embed.js moves the page the form is on; on the hosted page, this page moves.
          if (isEmbedded()) tellParent({ type: "parley:redirect", formId, url: outcome.afterSubmit.url })
          else window.location.assign(outcome.afterSubmit.url)
        }
        setSent(true)
      } else {
        setErrors(
          outcome.kind === "invalid"
            ? outcome.problems
            : { form: "This form isn't taking submissions right now. Try again later." },
        )
        // A render token is good for one submission; get a fresh one for the next try.
        setTries((count) => count + 1)
      }
    } catch {
      setErrors({ form: "We couldn't send that. Check your connection and try again." })
    }
    setBusy(false)
  }

  return (
    // On its own (the hosted page) the form is the page: its main landmark, its title the h1.
    <div className="FormPage" ref={frame} lang="en" role={embedded ? undefined : "main"}>
      <style>{PAGE_CSS}</style>
      {loaded.isPending ? <div role="status" aria-label="Loading" className="min-h-30" /> : null}
      {loaded.data === null ? <Notice>This form isn't available.</Notice> : null}
      {loaded.isError ? <Notice>This form didn't load. Refresh the page to try again.</Notice> : null}
      {form ? (
        <FormView
          content={form.content}
          customFields={form.customFields}
          privacyPolicyUrl={form.privacyPolicyUrl}
          values={values}
          onChange={(key, value) => {
            setValues((current) => ({ ...current, [key]: value }))
            if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest)
          }}
          onSubmit={() => void submit()}
          state={sent && form.content.afterSubmit.kind === "message" ? "sent" : "form"}
          // While a fresh token loads, the old one is spent: the button waits for it.
          busy={busy || loaded.isPlaceholderData}
          errors={errors}
          idPrefix={`f-${formId.slice(0, 8)}`}
          titleLevel={embedded ? 2 : 1}
          beforeButton={
            turnstile ? (
              <Turnstile
                siteKey={turnstile.siteKey}
                // Invisible shows nothing unless Cloudflare needs the visitor to act; managed always shows.
                options={{ appearance: turnstile.mode === "invisible" ? "interaction-only" : "always" }}
                onSuccess={(token) => {
                  turnstileToken.current = token
                }}
                // Without a token the submission still goes; the server holds it as spam if it must.
                onExpire={() => {
                  turnstileToken.current = ""
                }}
                onError={() => {
                  turnstileToken.current = ""
                }}
              />
            ) : null
          }
        />
      ) : null}
    </div>
  )
}

/** On its own light card, so it reads on any site's page behind the frame, dark or light. */
function Notice(props: { readonly children: string }) {
  return (
    <p className="m-0 rounded-lg bg-white p-4 font-sans text-neutral-700" role="status">
      {props.children}
    </p>
  )
}
