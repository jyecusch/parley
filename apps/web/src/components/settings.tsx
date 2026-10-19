import type { Permission, Team } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { relative } from "../lib/time.ts"
import { useCrt } from "./crt.tsx"
import {
  AlertIcon,
  BackIcon,
  CheckIcon,
  CloseIcon,
  ConnectionIcon,
  CopyIcon,
  DisplayIcon,
  KeyIcon,
  MembersIcon,
  ServiceAccountIcon,
} from "./icons.tsx"

/** What each scope lets a key or connection do, in the words the dialogs use. */
export const SCOPE_LABELS: Readonly<Record<Permission, string>> = {
  "records:read": "See contacts and companies",
  "records:write": "Create and edit them",
  "records:delete": "Delete and restore them",
  "fields:manage": "Manage custom fields",
  "members:manage": "Manage members",
  "service-accounts:manage": "Manage service accounts",
  "team:manage": "Manage the team",
}

/** Short scope names for lists: "records:write" → "write", "fields:manage" → "fields". */
const shortScope = (scope: Permission) => (scope.startsWith("records:") ? scope.slice(8) : scope.split(":")[0])

export const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase()
  const word = words[0] ?? "?"
  return `${word[0]?.toUpperCase() ?? ""}${word[1] ?? ""}`
}

/** "3d ago", or the fallback for something that hasn't happened. The full time is in the title. */
export function When(props: { readonly at: string | null; readonly never?: string }) {
  if (!props.at) return <span className="date">{props.never ?? "Never"}</span>
  const short = relative(props.at)
  return (
    <span className="date" title={new Date(props.at).toLocaleString()}>
      {short === "now" ? "Just now" : `${short} ago`}
    </span>
  )
}

/**
 * Settings replace the app sidebar with their own, with a way back (D90).
 */
export function SettingsShell(props: { readonly team: Team; readonly children: ReactNode }) {
  const params = { teamId: props.team.id }
  const crt = useCrt()
  return (
    <>
      <div ref={crt.screenRef} className="app">
        <nav className="side" aria-label="Settings">
          <Link className="nav back" to="/t/$teamId/contacts" params={params} search={{}}>
            <span className="ic">
              <BackIcon />
            </span>
            <span className="lbl">Back to Contacts</span>
          </Link>
          <section className="group" aria-labelledby="settings-team">
            <h2 className="glabel sm-t" id="settings-team">
              {props.team.name}
            </h2>
            <button className="nav" type="button" disabled title="Coming later">
              <span className="ic">
                <DisplayIcon size={16} />
              </span>
              <span className="lbl">General</span>
              <span className="trail sm-t">Later</span>
            </button>
            <button className="nav" type="button" disabled title="Coming later">
              <span className="ic">
                <MembersIcon />
              </span>
              <span className="lbl">Members</span>
              <span className="trail sm-t">Later</span>
            </button>
            <Link
              className="nav"
              activeProps={{ className: "nav on", "aria-current": "page" }}
              to="/t/$teamId/settings/service-accounts"
              params={params}
            >
              <span className="ic">
                <ServiceAccountIcon />
              </span>
              <span className="lbl">Service accounts</span>
            </Link>
          </section>
          <section className="group" aria-labelledby="settings-you">
            <h2 className="glabel sm-t" id="settings-you">
              You
            </h2>
            <Link
              className="nav"
              activeProps={{ className: "nav on", "aria-current": "page" }}
              to="/t/$teamId/settings/connections"
              params={params}
            >
              <span className="ic">
                <ConnectionIcon />
              </span>
              <span className="lbl">Connections</span>
            </Link>
            <Link
              className="nav"
              activeProps={{ className: "nav on", "aria-current": "page" }}
              to="/t/$teamId/settings/api-keys"
              params={params}
            >
              <span className="ic">
                <KeyIcon />
              </span>
              <span className="lbl">API keys</span>
            </Link>
          </section>
        </nav>
        <div className="content">{props.children}</div>
      </div>
      {crt.overlay}
    </>
  )
}

export function SettingsPage(props: {
  readonly title: string
  readonly intro: ReactNode
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <main className="card settings">
      <div className="hd1">
        <h1 className="crumb">
          <span className="root">Settings</span>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <span>{props.title}</span>
        </h1>
        <div className="spacer" />
        {props.action}
      </div>
      <div className="scroll">
        <div className="page">
          <div className="intro">
            <h2>{props.title}</h2>
            <p>{props.intro}</p>
          </div>
          {props.children}
        </div>
      </div>
    </main>
  )
}

/** A read-only value with its copy button inside the field (D97). */
export function CopyField(props: { readonly value: string; readonly label: string; readonly code?: boolean }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    await navigator.clipboard.writeText(props.value)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className={`copyfield ${props.code ? "code" : ""}`}>
      <output className="val mono" aria-label={props.label}>
        {props.value}
      </output>
      <button
        className="ibtn tip tip-b"
        type="button"
        aria-label={copied ? `Copied ${props.label}` : `Copy ${props.label}`}
        data-tip={copied ? "Copied" : "Copy"}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

export function ScopeChips(props: { readonly scopes: ReadonlyArray<Permission> }) {
  return (
    <span className="scopes">
      {props.scopes.map((scope) => (
        <span key={scope} className="scope" title={scope}>
          {shortScope(scope)}
        </span>
      ))}
    </span>
  )
}

/** Revoke with an inline confirmation in the row. There's no undo, so it asks once. */
export function RevokeButton(props: { readonly name: string; readonly onRevoke: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!confirming) {
    return (
      <button
        className="btn sm danger"
        type="button"
        aria-label={`Revoke ${props.name}`}
        onClick={() => setConfirming(true)}
      >
        Revoke
      </button>
    )
  }
  return (
    <span className="confirm">
      <button className="btn sm ghost" type="button" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button
        className="btn sm danger-solid"
        type="button"
        disabled={busy}
        aria-label={`Confirm: revoke ${props.name}`}
        onClick={async () => {
          setBusy(true)
          await props.onRevoke()
          setBusy(false)
          setConfirming(false)
        }}
      >
        Revoke
      </button>
    </span>
  )
}

export function Dialog(props: {
  readonly title: string
  readonly onClose?: () => void
  readonly footer: ReactNode
  readonly children: ReactNode
}) {
  const { onClose } = props
  useEffect(() => {
    if (!onClose) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <>
      {onClose ? (
        <button className="scrim" type="button" tabIndex={-1} aria-label="Close" onClick={onClose} />
      ) : (
        <div className="scrim" aria-hidden="true" />
      )}
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div className="dlg-h">
          <h2 id="dlg-title">{props.title}</h2>
          {onClose ? (
            <button className="ibtn" type="button" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          ) : null}
        </div>
        <div className="dlg-b">{props.children}</div>
        <div className="dlg-f">{props.footer}</div>
      </div>
    </>
  )
}

/** One toast at a time, dismissed after a while or by hand. */
export const useToast = () => {
  const [text, setText] = useState<string>()
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const show = useCallback((next: string) => {
    setText(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setText(undefined), 6000)
  }, [])
  const node = text ? (
    <div className="toast" role="status">
      <span>{text}</span>
      <button className="ibtn" type="button" aria-label="Dismiss" onClick={() => setText(undefined)}>
        <CloseIcon size={14} />
      </button>
    </div>
  ) : null
  return [node, show] as const
}

export function LoadingRows() {
  const rows = [
    { a: "55%", b: "35%", c: "60%" },
    { a: "45%", b: "40%", c: "75%" },
    { a: "65%", b: "30%", c: "55%" },
  ]
  return (
    <div className="box" role="status" aria-label="Loading">
      <table className="stable">
        <tbody>
          {rows.map((row) => (
            <tr key={row.a}>
              <td style={{ width: "27%" }}>
                <div className="who">
                  <span className="sk t" />
                  <span className="stack" style={{ flex: 1, gap: 6 }}>
                    <span className="sk" style={{ width: row.a }} />
                    <span className="sk" style={{ width: row.b }} />
                  </span>
                </div>
              </td>
              <td style={{ width: "17%" }}>
                <span className="sk" style={{ display: "block", width: row.c }} />
              </td>
              <td style={{ width: "19%" }}>
                <span className="sk" style={{ display: "block", width: "70%" }} />
              </td>
              <td>
                <span className="sk" style={{ display: "block", width: 56 }} />
              </td>
              <td>
                <span className="sk" style={{ display: "block", width: 48 }} />
              </td>
              <td style={{ width: 150 }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LoadFailed(props: {
  readonly title: string
  readonly message: UserText
  readonly onRetry: () => void
}) {
  return (
    <div className="box center" role="alert">
      <div className="empty">
        <div className="e-ic err">
          <AlertIcon />
        </div>
        <h2>{props.title}</h2>
        <p>{props.message}</p>
        <div className="actions">
          <button className="btn primary" type="button" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

export function Empty(props: { readonly icon: ReactNode; readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="box center">
      <div className="empty">
        <div className="e-ic">{props.icon}</div>
        <h2>{props.title}</h2>
        <p>{props.children}</p>
      </div>
    </div>
  )
}
