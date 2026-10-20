import type { RenderedEmail } from "@parley/domain"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { EMAIL_FRAME_CLASS, EmailPreview } from "./email-preview.tsx"
import { cn, ErrorText, FieldLabel, Hint, Input, Notice, Spacer, Textarea } from "./ui/index.ts"

/** Subject, preview text and body: what a template and a campaign both hold (R41). */
export interface Content {
  readonly subject: string
  readonly previewText: string
  readonly body: string
}

const MERGE_TAGS: ReadonlyArray<{ readonly tag: string; readonly label: string }> = [
  { tag: "{{first_name|there}}", label: "First name" },
  { tag: "{{last_name}}", label: "Last name" },
  { tag: "{{name}}", label: "Full name" },
  { tag: "{{email}}", label: "Email" },
  { tag: "{{company}}", label: "Company" },
]

/** Calls `save` once edits have paused, and reports whether everything is saved. */
export const useAutosave = <T,>(value: T, saved: T, save: (value: T) => Promise<void>, delay = 700) => {
  const [state, setState] = useState<"saved" | "saving" | "unsaved" | "failed">("saved")
  const latest = useRef(save)
  latest.current = save
  const dirty = JSON.stringify(value) !== JSON.stringify(saved)
  useEffect(() => {
    if (!dirty) {
      setState((current) => (current === "failed" ? current : "saved"))
      return
    }
    setState("unsaved")
    const timer = window.setTimeout(() => {
      setState("saving")
      latest.current(value).then(
        () => setState("saved"),
        () => setState("failed"),
      )
    }, delay)
    return () => window.clearTimeout(timer)
  }, [value, dirty, delay])
  return state
}

export function SaveState(props: { readonly state: "saved" | "saving" | "unsaved" | "failed" }) {
  const text =
    props.state === "saving"
      ? "Saving…"
      : props.state === "unsaved"
        ? "Unsaved"
        : props.state === "failed"
          ? "Not saved"
          : "Saved"
  return <span className={cn("ml-2.5 text-sm", props.state === "failed" ? "text-danger" : "text-subtle")}>{text}</span>
}

/**
 * The composer (05-ux view types): content on the left, the email as a recipient gets it on the
 * right. The preview is rendered by the server, so it matches what's sent.
 */
export function Composer(props: {
  readonly content: Content
  readonly onChange: (content: Content) => void
  readonly readOnly: boolean
  readonly preview: (content: Content) => Promise<RenderedEmail>
  /** Fields above the content, such as a campaign's segment and topic. */
  readonly settings?: ReactNode
  /** Above the preview, such as "Preview as". */
  readonly previewBar?: ReactNode
  /** Changes when the preview should render again without a content change, such as a new contact. */
  readonly previewKey?: string
}) {
  const body = useRef<HTMLTextAreaElement>(null)
  const [rendered, setRendered] = useState<RenderedEmail>()
  const [previewError, setPreviewError] = useState<string>()
  const { content, preview } = props
  const latest = useRef(preview)
  latest.current = preview

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewKey asks for a fresh render on its own
  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      latest.current(content).then(
        (next) => {
          if (!current) return
          setRendered(next)
          setPreviewError(undefined)
        },
        (failure: unknown) => current && setPreviewError(String((failure as { message?: string }).message ?? failure)),
      )
    }, 350)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [content, props.previewKey])

  const insert = (tag: string) => {
    const area = body.current
    if (!area || props.readOnly) return
    const start = area.selectionStart
    const end = area.selectionEnd
    const next = `${content.body.slice(0, start)}${tag}${content.body.slice(end)}`
    props.onChange({ ...content, body: next })
    window.requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 overflow-auto border-t border-line @max-4xl/content:grid-cols-1">
      <div className="flex flex-col gap-3.5 overflow-auto border-r border-line p-4 @max-4xl/content:border-r-0">
        {props.settings}
        <div className="flex min-w-0 flex-col">
          <FieldLabel htmlFor="cmp-subject">Subject</FieldLabel>
          <Input
            id="cmp-subject"
            maxLength={200}
            readOnly={props.readOnly}
            placeholder="What's this email about?"
            value={content.subject}
            onChange={(event) => props.onChange({ ...content, subject: event.target.value })}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <FieldLabel htmlFor="cmp-preview-text">
            Preview text <span className="text-subtle">(optional)</span>
          </FieldLabel>
          <Input
            id="cmp-preview-text"
            maxLength={200}
            readOnly={props.readOnly}
            placeholder="Shown after the subject in most inboxes"
            value={content.previewText}
            onChange={(event) => props.onChange({ ...content, previewText: event.target.value })}
          />
        </div>
        <div className="flex min-h-80 min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel htmlFor="cmp-body" className="pb-0">
              Body <span className="text-subtle">· Markdown</span>
            </FieldLabel>
            {props.readOnly ? null : (
              <span className="flex flex-wrap gap-1" title="Insert a merge tag">
                {MERGE_TAGS.map((entry) => (
                  <button
                    key={entry.tag}
                    className="h-6 cursor-pointer rounded-full bg-fill px-2.5 text-sm text-muted hover:text-fg"
                    type="button"
                    title={`Insert ${entry.tag}`}
                    onClick={() => insert(entry.tag)}
                  >
                    {entry.label}
                  </button>
                ))}
              </span>
            )}
          </div>
          <Textarea
            id="cmp-body"
            ref={body}
            className="min-h-64 flex-1 resize-none py-2.5 font-mono"
            readOnly={props.readOnly}
            placeholder={
              "# A heading\n\nWrite in Markdown: **bold**, _italic_, [links](https://example.com) and lists.\n\nHi {{first_name|there}},"
            }
            value={content.body}
            onChange={(event) => props.onChange({ ...content, body: event.target.value })}
          />
          <Hint>Parley adds your footer, with the unsubscribe link, to the end of every email.</Hint>
        </div>
      </div>
      <div className="flex min-h-0 flex-col bg-canvas">
        <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
          <span className="text-sm text-subtle">Preview</span>
          <Spacer />
          {props.previewBar}
        </div>
        {rendered ? (
          <div className="mx-3.5 mb-2.5 rounded-md bg-surface px-3 py-2.5 inset-ring inset-ring-line">
            <div className="font-semibold">{rendered.subject || "No subject"}</div>
            {rendered.previewText ? <div className="text-sm text-subtle">{rendered.previewText}</div> : null}
          </div>
        ) : null}
        {rendered && rendered.unknownMergeTags.length > 0 ? (
          <Notice tone="warn" className="mx-3.5 mb-2.5 text-sm">
            Parley doesn't know {rendered.unknownMergeTags.map((tag) => `{{${tag}}}`).join(", ")}, so{" "}
            {rendered.unknownMergeTags.length === 1 ? "it's" : "they're"} sent as typed.
          </Notice>
        ) : null}
        {previewError ? <ErrorText className="mx-3.5 mb-2.5">{previewError}</ErrorText> : null}
        {rendered ? <EmailPreview html={rendered.html} label="Email preview" /> : <div className={EMAIL_FRAME_CLASS} />}
      </div>
    </div>
  )
}
