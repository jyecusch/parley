import type { Company, Contact } from "@parley/domain"
import { getRouteApi } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { initialsOf } from "../lib/contacts.ts"
import { CloseIcon } from "./icons.tsx"
import { initialsOfName } from "./record.tsx"

const teamRoute = getRouteApi("/t/$teamId")

type Size = "sm" | "md" | "lg"

/** Gravatar addresses by email, hashed once per session. */
const gravatars = new Map<string, Promise<string>>()
const gravatarOf = (email: string) => {
  const address = email.trim().toLowerCase()
  let url = gravatars.get(address)
  if (!url) {
    url = crypto.subtle.digest("SHA-256", new TextEncoder().encode(address)).then((hash) => {
      const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")
      // d=404 so a missing Gravatar fails to load and the initials show instead.
      return `https://gravatar.com/avatar/${hex}?s=96&d=404`
    })
    gravatars.set(address, url)
  }
  return url
}

/** An image, or the fallback when there's none or it fails to load. */
function RecordImage(props: { readonly src: string | null; readonly className: string; readonly fallback: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = props.src !== null && failed !== props.src
  return (
    <span className={`${props.className} ${showImage ? "has-img" : ""}`} aria-hidden="true">
      {showImage ? (
        <img src={props.src ?? undefined} alt="" loading="lazy" onError={() => setFailed(props.src)} />
      ) : (
        props.fallback
      )}
    </span>
  )
}

/**
 * A contact's avatar (D75): the uploaded one, else their Gravatar when the team allows it, else
 * initials.
 */
export function ContactAvatar(props: {
  readonly contact: Pick<Contact, "firstName" | "lastName" | "displayName" | "avatarUrl" | "emails">
  readonly size?: Size
}) {
  const { team } = teamRoute.useLoaderData()
  const email = props.contact.emails[0]?.address
  const [gravatar, setGravatar] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    if (team.gravatar && email && !props.contact.avatarUrl) {
      void gravatarOf(email).then((url) => current && setGravatar(url))
    } else setGravatar(null)
    return () => {
      current = false
    }
  }, [team.gravatar, email, props.contact.avatarUrl])
  return (
    <RecordImage
      src={props.contact.avatarUrl ?? gravatar}
      className={`av ${props.size === "lg" ? "lg" : props.size === "md" ? "md" : ""}`}
      fallback={initialsOf(props.contact)}
    />
  )
}

/** A company's logo: uploaded or fetched from its domain, else initials. */
export function CompanyLogo(props: {
  readonly company: Pick<Company, "name"> & { readonly logoUrl?: string | null }
  readonly size?: Size
}) {
  return (
    <RecordImage
      src={props.company.logoUrl ?? null}
      className={`tile ${props.size ?? ""}`}
      fallback={initialsOfName(props.company.name)}
    />
  )
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/**
 * Wraps an avatar or logo in the panel: click to upload a new one, or remove the uploaded one.
 * Uploading is an edit, so it needs records:write; without it it is shown as is.
 */
export function ImageEditor(props: {
  readonly children: ReactNode
  readonly label: string
  readonly hasUpload: boolean
  readonly canEdit: boolean
  readonly onUpload: (image: string) => Promise<void>
  readonly onRemove: () => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  if (!props.canEdit) return <>{props.children}</>
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className={`imgedit ${busy ? "busy" : ""}`}>
      <button
        className="imgbtn tip tip-b"
        type="button"
        aria-label={`Upload ${props.label}`}
        data-tip={`Upload ${props.label}`}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {props.children}
      </button>
      {props.hasUpload ? (
        <button
          className="imgx"
          type="button"
          aria-label={`Remove ${props.label}`}
          title={`Remove ${props.label}`}
          disabled={busy}
          onClick={() => void run(props.onRemove)}
        >
          <CloseIcon className="size-3" />
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) void run(async () => props.onUpload(await readAsDataUrl(file)))
        }}
      />
    </span>
  )
}
