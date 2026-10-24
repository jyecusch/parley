import { type SocialNetworkId, socialNetworkOf } from "@parley/domain"
import { useState } from "react"
import type { IconType } from "react-icons"
import {
  FaBluesky,
  FaFacebook,
  FaGithub,
  FaInstagram,
  FaLinkedin,
  FaThreads,
  FaTiktok,
  FaXTwitter,
  FaYoutube,
} from "react-icons/fa6"
import { CloseIcon, LinkIcon, PlusIcon } from "./icons.tsx"
import { EmptyValue } from "./record.tsx"
import { Button as PlainButton } from "./ui/button.tsx"
import { cn, IconButton, InlineInput, PropertyRow, propertyValueClass, Textarea, TextButton } from "./ui/index.ts"

/** Longer than this, a description shows clamped with "Show more". */
const LONG_DESCRIPTION = 280

/**
 * A company's description (D132), or a segment's (D141): text with its line breaks, edited in place. ⌘Enter or leaving the
 * field saves; Escape cancels.
 */
export function EditableDescription(props: {
  readonly value: string | null
  readonly disabled?: boolean
  /** The longest description allowed; companies take 5,000 characters. */
  readonly maxLength?: number
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
        maxLength={props.maxLength ?? 5000}
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
      <PlainButton
        variant={null}
        size={null}
        type="button"
        disabled={props.disabled}
        className={cn(
          "-mx-1.5 w-full cursor-text rounded-md px-1.5 py-1 text-left leading-6 whitespace-pre-line text-muted hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent",
          long && !expanded && "line-clamp-4",
        )}
        onClick={() => setEditing(true)}
      >
        {props.value}
      </PlainButton>
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
      <PlainButton
        variant={null}
        size={null}
        className={cn(propertyValueClass, "tabular-nums")}
        type="button"
        onClick={() => setEditing(true)}
      >
        {props.value === null ? (
          <EmptyValue />
        ) : props.grouped === false ? (
          String(props.value)
        ) : (
          props.value.toLocaleString()
        )}
      </PlainButton>
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

/** The networks' own marks (react-icons, Font Awesome brands); a link otherwise. */
const NETWORK_ICONS: Readonly<Record<SocialNetworkId, IconType>> = {
  linkedin: FaLinkedin,
  x: FaXTwitter,
  facebook: FaFacebook,
  instagram: FaInstagram,
  youtube: FaYoutube,
  github: FaGithub,
  bluesky: FaBluesky,
  threads: FaThreads,
  tiktok: FaTiktok,
}

export function SocialIcon(props: { readonly network: SocialNetworkId | undefined }) {
  if (!props.network) return <LinkIcon className="size-4 text-subtle" />
  const Mark = NETWORK_ICONS[props.network]
  return <Mark aria-hidden="true" className="size-4 shrink-0 text-subtle" />
}
