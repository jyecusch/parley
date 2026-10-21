import type { RenderedEmail, TeamId } from "@parley/domain"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { useComposerLayout } from "./composer-layout.ts"
import { EMAIL_FRAME_CLASS, EmailPreview } from "./email-preview.tsx"
import { SideBySideIcon, StackedIcon } from "./icons.tsx"
import { type BodyTransform, imageMarkdown, insertBlock, MarkdownToolbar, readAsDataUrl } from "./markdown-toolbar.tsx"
import { Button as PlainButton } from "./ui/button.tsx"
import { cn, ErrorText, FieldLabel, Hint, IconButton, Input, Notice, Spacer, Textarea } from "./ui/index.ts"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable.tsx"

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
 *
 * The text fields hold their own text (defaultValue) and report each change, rather than React
 * writing the value back on every keystroke: on this busy screen that write-back could land after
 * the next keystroke and drop it. Toolbar edits set the field's text directly.
 */
export function Composer(props: {
  /** The team images are uploaded to. */
  readonly teamId: TeamId
  readonly content: Content
  /** Only the fields that changed, so quick typing never overwrites a keystroke with a stale copy. */
  readonly onChange: (change: Partial<Content>) => void
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
  const frame = useRef<HTMLDivElement>(null)
  const layout = useComposerLayout(frame)
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

  const [pasteError, setPasteError] = useState<string>()

  /** Applies a toolbar edit to the body, then puts the selection where the edit says. */
  const edit = (transform: BodyTransform) => {
    const area = body.current
    if (!area || props.readOnly) return
    const next = transform(area.value, area.selectionStart, area.selectionEnd)
    area.value = next.text
    props.onChange({ body: next.text })
    window.requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(next.start, next.end)
    })
  }

  /** A pasted image is uploaded and its Markdown inserted where the cursor was. */
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"))
    if (!pasted || props.readOnly) return
    event.preventDefault()
    setPasteError(undefined)
    void readAsDataUrl(pasted)
      .then((image) => call("emailImages.upload", { teamId: props.teamId, image }))
      .then((uploaded) => edit(insertBlock(imageMarkdown(uploaded, ""))))
      .catch((failure: unknown) => setPasteError(messageOf(failure)))
  }

  const insert = (tag: string) => {
    const area = body.current
    if (!area || props.readOnly) return
    const start = area.selectionStart
    const end = area.selectionEnd
    const next = `${area.value.slice(0, start)}${tag}${area.value.slice(end)}`
    area.value = next
    props.onChange({ body: next })
    window.requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  // Side by side, the content and the preview scroll on their own, split by a handle that can be
  // dragged. Stacked, only the whole composer scrolls: the panes, the preview and the body grow to fit.
  const stacked = layout.stacked
  const contentPane = (
    <>
      {props.settings}
      <div className="flex min-w-0 flex-col">
        <FieldLabel htmlFor="cmp-subject">Subject</FieldLabel>
        <Input
          id="cmp-subject"
          maxLength={200}
          readOnly={props.readOnly}
          placeholder="What's this email about?"
          defaultValue={content.subject}
          onChange={(event) => props.onChange({ subject: event.target.value })}
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
          defaultValue={content.previewText}
          onChange={(event) => props.onChange({ previewText: event.target.value })}
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
                <PlainButton
                  variant={null}
                  size={null}
                  key={entry.tag}
                  className="h-6 cursor-pointer rounded-full bg-fill px-2.5 text-sm text-muted hover:text-fg"
                  type="button"
                  title={`Insert ${entry.tag}`}
                  onClick={() => insert(entry.tag)}
                >
                  {entry.label}
                </PlainButton>
              ))}
            </span>
          )}
        </div>
        {props.readOnly ? null : <MarkdownToolbar teamId={props.teamId} disabled={props.readOnly} onEdit={edit} />}
        <Textarea
          id="cmp-body"
          onPaste={onPaste}
          ref={body}
          className={cn("min-h-64 flex-1 resize-none py-2.5 font-mono", stacked && "[field-sizing:content]")}
          readOnly={props.readOnly}
          placeholder={
            "# A heading\n\nWrite in Markdown: **bold**, _italic_, [links](https://example.com) and lists.\n\nHi {{first_name|there}},"
          }
          defaultValue={content.body}
          onChange={(event) => props.onChange({ body: event.target.value })}
        />
        {pasteError ? <ErrorText>{pasteError}</ErrorText> : null}
        <Hint>Parley adds your footer, with the unsubscribe link, to the end of every email.</Hint>
      </div>
    </>
  )
  const previewPane = (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        <span className="text-sm text-subtle">Preview</span>
        <Spacer />
        {props.previewBar}
        <IconButton
          label={stacked ? "Show the preview beside the content" : "Show the preview under the content"}
          tip={stacked ? "Side by side" : "Stacked"}
          size="xs"
          onClick={layout.toggle}
        >
          {stacked ? <SideBySideIcon className="size-4" /> : <StackedIcon className="size-4" />}
        </IconButton>
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
      {rendered ? (
        <EmailPreview html={rendered.html} label="Email preview" grow={stacked} />
      ) : (
        <div className={EMAIL_FRAME_CLASS} />
      )}
    </>
  )
  // Stacked: one column that scrolls as a whole.
  if (stacked) {
    return (
      <div ref={frame} className="grid min-h-0 flex-1 grid-cols-1 overflow-auto border-t border-line">
        <div className="flex min-w-0 flex-col gap-3.5 overflow-visible p-4">{contentPane}</div>
        <div className="flex min-h-0 min-w-0 flex-col border-t border-line bg-canvas">{previewPane}</div>
      </div>
    )
  }
  // Side by side (shadcn's Resizable): drag the handle, or focus it and use the arrow keys.
  return (
    <ResizablePanelGroup
      elementRef={frame}
      orientation="horizontal"
      defaultLayout={{ content: layout.split, preview: 100 - layout.split }}
      onLayoutChanged={(next) => {
        const split = next.content
        if (split !== undefined) layout.commitSplit(split)
      }}
      className="h-auto min-h-0 flex-1 overflow-auto border-t border-line"
    >
      <ResizablePanel id="content" minSize="30" maxSize="70" className="flex min-w-0 flex-col gap-3.5 p-4">
        {contentPane}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize the content and preview"
        // No width of its own, so the content is split% of the whole width, as it was; the 12px
        // grab strip (::after) and its line (::before) sit over the preview's left padding.
        className="relative z-10 w-0 cursor-col-resize touch-none bg-transparent before:absolute before:inset-y-0 before:left-1.5 before:w-px before:-translate-x-1/2 before:bg-line before:transition-colors after:absolute after:inset-y-0 after:left-0 after:w-3 after:translate-x-0 hover:before:w-0.5 hover:before:bg-control focus-visible:bg-transparent focus-visible:outline-none focus-visible:before:w-0.5 focus-visible:before:bg-focus motion-reduce:before:transition-none"
      />
      <ResizablePanel id="preview" className="flex min-h-0 min-w-0 flex-col bg-canvas pl-3">
        {previewPane}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
