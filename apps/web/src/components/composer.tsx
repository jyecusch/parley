import type { RenderedEmail } from "@parley/domain"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { EmailPreview } from "./email-preview.tsx"

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
  return <span className={`sm-t savestate ${props.state === "failed" ? "c-warn" : "c-muted"}`}>{text}</span>
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
    <div className="composer">
      <div className="cmp-edit">
        {props.settings}
        <div className="cmp-f">
          <label className="flabel sm-t" htmlFor="cmp-subject">
            Subject
          </label>
          <input
            id="cmp-subject"
            className="inp"
            maxLength={200}
            readOnly={props.readOnly}
            placeholder="What's this email about?"
            value={content.subject}
            onChange={(event) => props.onChange({ ...content, subject: event.target.value })}
          />
        </div>
        <div className="cmp-f">
          <label className="flabel sm-t" htmlFor="cmp-preview-text">
            Preview text <span className="c-muted">(optional)</span>
          </label>
          <input
            id="cmp-preview-text"
            className="inp"
            maxLength={200}
            readOnly={props.readOnly}
            placeholder="Shown after the subject in most inboxes"
            value={content.previewText}
            onChange={(event) => props.onChange({ ...content, previewText: event.target.value })}
          />
        </div>
        <div className="cmp-f grow">
          <div className="cmp-bodyhead">
            <label className="flabel sm-t" htmlFor="cmp-body">
              Body <span className="c-muted">· Markdown</span>
            </label>
            {props.readOnly ? null : (
              <span className="tags" title="Insert a merge tag">
                {MERGE_TAGS.map((entry) => (
                  <button
                    key={entry.tag}
                    className="tagbtn sm-t"
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
          <textarea
            id="cmp-body"
            ref={body}
            className="inp cmp-body mono"
            readOnly={props.readOnly}
            placeholder={
              "# A heading\n\nWrite in Markdown: **bold**, _italic_, [links](https://example.com) and lists.\n\nHi {{first_name|there}},"
            }
            value={content.body}
            onChange={(event) => props.onChange({ ...content, body: event.target.value })}
          />
          <p className="hint sm-t">Parley adds your footer, with the unsubscribe link, to the end of every email.</p>
        </div>
      </div>
      <div className="cmp-prev">
        <div className="cmp-prevbar">
          <span className="sm-t c-muted">Preview</span>
          <div className="spacer" />
          {props.previewBar}
        </div>
        {rendered ? (
          <div className="cmp-inbox">
            <div className="cmp-subject">{rendered.subject || "No subject"}</div>
            {rendered.previewText ? <div className="sm-t c-muted">{rendered.previewText}</div> : null}
          </div>
        ) : null}
        {rendered && rendered.unknownMergeTags.length > 0 ? (
          <p className="warn sm-t" style={{ margin: "0 12px 8px" }}>
            Parley doesn't know {rendered.unknownMergeTags.map((tag) => `{{${tag}}}`).join(", ")}, so{" "}
            {rendered.unknownMergeTags.length === 1 ? "it's" : "they're"} sent as typed.
          </p>
        ) : null}
        {previewError ? (
          <p className="err sm-t" style={{ margin: "0 12px 8px" }}>
            {previewError}
          </p>
        ) : null}
        {rendered ? <EmailPreview html={rendered.html} label="Email preview" /> : <div className="cmp-frame" />}
      </div>
    </div>
  )
}
