import type { EmailImage, TeamId } from "@parley/domain"
import { type DragEvent, type RefObject, useId, useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { ButtonShapeIcon, DividerIcon, ImageIcon, LinkIcon, ListIcon } from "./icons.tsx"
import { PopoverAnchor } from "./popover-anchor.tsx"
import { Button as PlainButton } from "./ui/button.tsx"
import { Button, cn, ErrorText, Hint, IconButton, Input } from "./ui/index.ts"
import { Popover, PopoverContent } from "./ui/popover.tsx"

/** A change to the body: its new text and where the selection goes. */
export interface BodyEdit {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** Turns the body and its selection into the edited body. */
export type BodyTransform = (text: string, start: number, end: number) => BodyEdit

/** Wraps the selection, or a placeholder selected for typing over, in Markdown marks such as **. */
const wrap =
  (before: string, after: string, placeholder: string): BodyTransform =>
  (text, start, end) => {
    const chosen = text.slice(start, end) || placeholder
    const next = `${text.slice(0, start)}${before}${chosen}${after}${text.slice(end)}`
    return { text: next, start: start + before.length, end: start + before.length + chosen.length }
  }

/** Puts `prefix` at the start of every line the selection touches, as headings and lists need. */
const prefixLines =
  (prefix: string): BodyTransform =>
  (text, start, end) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1
    const lineEnd = text.indexOf("\n", end) === -1 ? text.length : text.indexOf("\n", end)
    const lines = text
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
      .join("\n")
    const next = `${text.slice(0, lineStart)}${lines}${text.slice(lineEnd)}`
    return { text: next, start: lineStart, end: lineStart + lines.length }
  }

/** Inserts a block on its own lines, with a blank line either side, at the cursor. */
export const insertBlock =
  (block: string, select?: { readonly from: number; readonly to: number }): BodyTransform =>
  (text, start, end) => {
    const before = text.slice(0, start)
    const after = text.slice(end)
    const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
    const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n"
    const at = before.length + lead.length
    return {
      text: `${before}${lead}${block}${trail}${after}`,
      start: select ? at + select.from : at + block.length,
      end: select ? at + select.to : at + block.length,
    }
  }

const BUTTON_BLOCK = "[[button: Button text | https://]]"

/** Markdown for an image, with its description escaped so it can't close the brackets early. */
export const imageMarkdown = (image: EmailImage, description: string) =>
  `![${description.replace(/[[\]]/g, "")}](${image.url})`

/** Reads a file as a data: URL, which the upload operations take. */
export const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read."))
    reader.readAsDataURL(file)
  })

/**
 * The formatting toolbar above the Markdown body (D118). It only writes Markdown, so what agents
 * write over MCP and what people make here are the same thing.
 */
export function MarkdownToolbar(props: {
  readonly teamId: TeamId
  readonly disabled: boolean
  readonly onEdit: (transform: BodyTransform) => void
}) {
  const [picking, setPicking] = useState(false)
  const imageButton = useRef<HTMLButtonElement>(null)
  const { onEdit } = props
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="relative flex flex-wrap items-center gap-0.5 rounded-md bg-fill px-1 py-0.5"
    >
      <IconButton
        label="Bold"
        tip="Bold"
        size="xs"
        disabled={props.disabled}
        onClick={() => onEdit(wrap("**", "**", "bold text"))}
      >
        <span className="font-bold">B</span>
      </IconButton>
      <IconButton
        label="Italic"
        tip="Italic"
        size="xs"
        disabled={props.disabled}
        onClick={() => onEdit(wrap("_", "_", "italic text"))}
      >
        <span className="italic">I</span>
      </IconButton>
      <IconButton
        label="Link"
        tip="Link"
        size="xs"
        disabled={props.disabled}
        onClick={() =>
          onEdit((text, start, end) => {
            const label = text.slice(start, end) || "link text"
            const markdown = `[${label}](https://)`
            const next = `${text.slice(0, start)}${markdown}${text.slice(end)}`
            // Select the address so it can be typed over.
            const at = start + label.length + 3
            return { text: next, start: at, end: at + "https://".length }
          })
        }
      >
        <LinkIcon className="size-4" />
      </IconButton>
      <IconButton
        label="Heading"
        tip="Heading"
        size="xs"
        disabled={props.disabled}
        onClick={() => onEdit(prefixLines("## "))}
      >
        <span className="font-semibold">H</span>
      </IconButton>
      <IconButton label="List" tip="List" size="xs" disabled={props.disabled} onClick={() => onEdit(prefixLines("- "))}>
        <ListIcon className="size-4" />
      </IconButton>
      <span className="mx-1.5 h-5 w-px bg-line-strong" aria-hidden="true" />
      <Button
        variant="ghost"
        size="sm"
        disabled={props.disabled}
        onClick={() => onEdit(insertBlock(BUTTON_BLOCK, { from: 10, to: 21 }))}
      >
        <ButtonShapeIcon className="size-4" />
        Button
      </Button>
      <PlainButton
        ref={imageButton}
        type="button"
        variant="ghost"
        size="sm"
        disabled={props.disabled}
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => setPicking((open) => !open)}
      >
        <ImageIcon className="size-4" />
        Image
      </PlainButton>
      <Button variant="ghost" size="sm" disabled={props.disabled} onClick={() => onEdit(insertBlock("---"))}>
        <DividerIcon className="size-4" />
        Divider
      </Button>
      {picking ? (
        <ImagePicker
          teamId={props.teamId}
          returnFocus={imageButton}
          onClose={() => setPicking(false)}
          onInsert={(markdown) => {
            setPicking(false)
            onEdit(insertBlock(markdown))
          }}
        />
      ) : null}
    </div>
  )
}

/** Adds an image: uploaded, dropped, pasted or copied from a URL, then hosted by Parley (D120). */
function ImagePicker(props: {
  readonly teamId: TeamId
  readonly onClose: () => void
  readonly onInsert: (markdown: string) => void
  /** The button that opened it, which gets focus back when it closes. */
  readonly returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const [url, setUrl] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const ids = { url: useId(), description: useId() }

  const add = async (work: () => Promise<EmailImage>) => {
    setBusy(true)
    setError(undefined)
    try {
      const image = await work()
      props.onInsert(imageMarkdown(image, description.trim()))
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  const upload = (chosen: File) =>
    void add(async () => call("emailImages.upload", { teamId: props.teamId, image: await readAsDataUrl(chosen) }))
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const dropped = [...event.dataTransfer.files].find((entry) => entry.type.startsWith("image/"))
    if (dropped) upload(dropped)
  }

  return (
    <Popover open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <PopoverAnchor className="top-full left-0" />
      <PopoverContent aria-label="Add an image" className="flex flex-col gap-3 p-3.5" finalFocus={props.returnFocus}>
        <div className="font-semibold">Add an image</div>
        <PlainButton
          type="button"
          variant={null}
          size={null}
          disabled={busy}
          className={cn(
            "flex h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed px-3 text-center text-sm text-muted",
            dragging ? "border-fg bg-hover" : "border-control bg-surface hover:bg-hover",
          )}
          onClick={() => file.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {busy ? (
            "Adding…"
          ) : (
            <span>
              Drop an image, paste one into the body, or <u>choose a file</u>
            </span>
          )}
        </PlainButton>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            if (chosen) upload(chosen)
            event.target.value = ""
          }}
        />
        <div className="flex items-center gap-2 text-sm text-subtle" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          or from a URL
          <span className="h-px flex-1 bg-line" />
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (url.trim()) void add(() => call("emailImages.import", { teamId: props.teamId, url: url.trim() }))
          }}
        >
          <label htmlFor={ids.url} className="sr-only">
            Image URL
          </label>
          <Input
            id={ids.url}
            className="h-9 min-w-0 flex-1 text-sm"
            type="url"
            placeholder="https://example.com/image.png"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy || !url.trim().startsWith("https://")}>
            Add
          </Button>
        </form>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.description} className="text-sm font-medium">
            Description <span className="font-normal text-subtle">(for people who can't see images)</span>
          </label>
          <Input
            id={ids.description}
            className="h-9 text-sm"
            maxLength={200}
            placeholder="What the image shows"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Hint>Parley keeps a copy, resized for email, so it still shows if the original moves.</Hint>
      </PopoverContent>
    </Popover>
  )
}
