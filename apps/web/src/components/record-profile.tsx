import { type SocialNetworkId, socialNetworkOf } from "@parley/domain"
import { type ReactNode, useState } from "react"
import { CloseIcon, PlusIcon } from "./icons.tsx"
import { EmptyValue } from "./record.tsx"
import { cn, IconButton, InlineInput, PropertyRow, propertyValueClass, Textarea, TextButton } from "./ui/index.ts"

/** Longer than this, a description shows clamped with "Show more". */
const LONG_DESCRIPTION = 280

/**
 * A company's description (D132): text with its line breaks, edited in place. ⌘Enter or leaving the
 * field saves; Escape cancels.
 */
export function EditableDescription(props: {
  readonly value: string | null
  readonly disabled?: boolean
  readonly onSave: (value: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  if (editing) {
    return (
      <Textarea
        aria-label="Description"
        className="min-h-28 text-base"
        defaultValue={props.value ?? ""}
        maxLength={5000}
        autoFocus
        onBlur={(event) => {
          setEditing(false)
          const next = event.currentTarget.value.trim() || null
          if (next !== props.value) props.onSave(next)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.blur()
          if (event.key === "Escape") {
            event.stopPropagation()
            setEditing(false)
          }
        }}
      />
    )
  }
  if (!props.value) {
    return props.disabled ? null : (
      <TextButton onClick={() => setEditing(true)}>
        <PlusIcon className="size-4" />
        Add a description
      </TextButton>
    )
  }
  const long = props.value.length > LONG_DESCRIPTION
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={props.disabled}
        className={cn(
          "-mx-1.5 w-full cursor-text rounded-md px-1.5 py-1 text-left leading-6 whitespace-pre-line text-muted hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent",
          long && !expanded && "line-clamp-4",
        )}
        onClick={() => setEditing(true)}
      >
        {props.value}
      </button>
      {long ? (
        <TextButton className="text-sm" onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show less" : "Show more"}
        </TextButton>
      ) : null}
    </div>
  )
}

/** A whole number or amount, edited in place; shown with thousands separators. */
export function EditableNumber(props: {
  readonly label: string
  readonly value: number | null
  readonly whole?: boolean
  readonly grouped?: boolean
  readonly min?: number
  readonly max?: number
  readonly onSave: (value: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const id = `edit-${props.label.replace(/\s+/g, "-").toLowerCase()}`
  if (editing) {
    return (
      <PropertyRow label={props.label} htmlFor={id}>
        <InlineInput
          id={id}
          type="number"
          inputMode={props.whole ? "numeric" : "decimal"}
          step={props.whole ? 1 : "any"}
          min={props.min}
          max={props.max}
          defaultValue={props.value ?? ""}
          autoFocus
          onBlur={(event) => {
            setEditing(false)
            const text = event.currentTarget.value.trim()
            const parsed = text === "" ? null : Number(text)
            const next = parsed === null || !Number.isFinite(parsed) ? null : props.whole ? Math.round(parsed) : parsed
            if (next !== props.value) props.onSave(next)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        />
      </PropertyRow>
    )
  }
  return (
    <PropertyRow label={props.label}>
      <button className={cn(propertyValueClass, "tabular-nums")} type="button" onClick={() => setEditing(true)}>
        {props.value === null ? (
          <EmptyValue />
        ) : props.grouped === false ? (
          String(props.value)
        ) : (
          props.value.toLocaleString()
        )}
      </button>
    </PropertyRow>
  )
}

/** A profile link's address without the scheme, for display: "linkedin.com/company/acme". */
const shortAddress = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")

/** What someone typed as a profile link, as an https address; undefined when it isn't one. */
const toProfileUrl = (text: string) => {
  const value = text.trim().replace(/^http:\/\//i, "https://")
  const url = /^https:\/\//i.test(value) ? value : `https://${value}`
  return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(url) && url.length <= 500 ? url : undefined
}

/**
 * Social profiles (D133): each link as its network's name and icon, opening in a new tab; add or
 * remove links in place.
 */
export function SocialProfilesField(props: {
  readonly profiles: ReadonlyArray<string>
  readonly disabled?: boolean
  readonly onSave: (profiles: ReadonlyArray<string>) => void
}) {
  const [adding, setAdding] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const add = (text: string) => {
    if (text.trim() === "") {
      setAdding(false)
      setInvalid(false)
      return
    }
    const url = toProfileUrl(text)
    if (!url) {
      setInvalid(true)
      return
    }
    setAdding(false)
    setInvalid(false)
    if (!props.profiles.includes(url)) props.onSave([...props.profiles, url])
  }
  return (
    <PropertyRow label="Social profiles">
      <div className="flex min-w-0 flex-col gap-0.5 py-1">
        {props.profiles.map((url) => {
          const network = socialNetworkOf(url)
          return (
            <div key={url} className="group/profile flex min-w-0 items-center gap-2">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-2 text-fg no-underline hover:underline"
                title={url}
              >
                <SocialIcon network={network?.id} />
                <span className="truncate">{network ? network.label : shortAddress(url)}</span>
              </a>
              {props.disabled ? null : (
                <IconButton
                  label={`Remove ${network?.label ?? shortAddress(url)}`}
                  size="xs"
                  className="opacity-0 group-hover/profile:opacity-100 focus-visible:opacity-100"
                  onClick={() => props.onSave(props.profiles.filter((entry) => entry !== url))}
                >
                  <CloseIcon className="size-3.5" />
                </IconButton>
              )}
            </div>
          )
        })}
        {adding ? (
          <div className="flex flex-col gap-1">
            <InlineInput
              aria-label="Profile link"
              aria-invalid={invalid}
              placeholder="linkedin.com/company/acme"
              autoFocus
              onBlur={(event) => add(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") add(event.currentTarget.value)
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setAdding(false)
                  setInvalid(false)
                }
              }}
            />
            {invalid ? (
              <span className="text-sm text-danger">That isn't a link. Paste the profile's address.</span>
            ) : null}
          </div>
        ) : props.disabled ? (
          props.profiles.length === 0 ? (
            <EmptyValue />
          ) : null
        ) : (
          <TextButton className="py-0.5" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            {props.profiles.length === 0 ? "Add a profile" : "Add another"}
          </TextButton>
        )}
      </div>
    </PropertyRow>
  )
}

/** Simple monochrome marks for the networks Parley recognises; a link otherwise. */
export function SocialIcon(props: { readonly network: SocialNetworkId | undefined }) {
  const glyph: ReactNode = (() => {
    switch (props.network) {
      case "linkedin":
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" />
          </>
        )
      case "x":
        return <path d="M4 4l16 16M20 4L4 20" />
      case "facebook":
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M15 8h-1.5A2.5 2.5 0 0 0 11 10.5V21M8.5 13H15" />
          </>
        )
      case "instagram":
        return (
          <>
            <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <path d="M17 7v.01" />
          </>
        )
      case "youtube":
        return (
          <>
            <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
            <path d="M10 9.5v5l4.5-2.5z" />
          </>
        )
      case "github":
        return (
          <path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.8-2.2c2.8-.3 5.8-1.4 5.8-6.3a4.9 4.9 0 0 0-1.3-3.4 4.6 4.6 0 0 0-.1-3.4s-1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.3 2 5.3 2.3 5.3 2.3a4.6 4.6 0 0 0-.1 3.4A4.9 4.9 0 0 0 3.9 9c0 4.9 3 6 5.8 6.3a3 3 0 0 0-.8 2.2V21" />
        )
      case "bluesky":
        return (
          <path d="M12 11c-1.5-3-5-6.5-7-6.5-1.5 0-1.5 2-1 4 .7 2.6 3.5 3 6 2.7-3 .5-5.5 1.8-3 4.8 2.7 3.2 4.3-.5 5-3 .7 2.5 2.3 6.2 5 3 2.5-3 0-4.3-3-4.8 2.5.3 5.3-.1 6-2.7.5-2 .5-4-1-4-2 0-5.5 3.5-7 6.5Z" />
        )
      case "threads":
        return (
          <path d="M16.5 11.5c-.8-3-3-4-5-3.8-2.3.2-3.7 2-3.5 3.8.2 1.9 2 3 4 2.8 2.4-.3 3.6-2.4 3.2-5.6M12 21c-5 0-8.5-3.5-8.5-9S7 3 12 3s7.5 2.5 8.5 6" />
        )
      case "tiktok":
        return <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.5 2.5 4.5 5 4.5" />
      default:
        return (
          <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
        )
    }
  })()
  return (
    <svg
      className="size-4 shrink-0 text-subtle"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  )
}
