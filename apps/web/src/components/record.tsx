import type { ActivityEntry, FieldProblem, RecordType } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { type ReactNode, useState } from "react"
import { isApiFailure } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"
import { AgentIcon, AlertIcon } from "./icons.tsx"

/** Pieces shared by the contact and company screens: inline editing, activity and load states. */

export const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Normalises what people type ("+61 400 812 337") to E.164 (D34). */
export const toE164 = (value: string) => value.replace(/[\s().-]/g, "")

export const problemFor = (problems: ReadonlyArray<FieldProblem> | undefined, field: string) =>
  problems?.find((problem) => problem.field === field)?.userMessage

export const problemsOf = (failure: unknown): ReadonlyArray<FieldProblem> | undefined => {
  if (!isApiFailure(failure) || failure.error._tag !== "InputRejected") return undefined
  return (failure.error.details as { problems?: ReadonlyArray<FieldProblem> } | undefined)?.problems
}

/** A record's initials: "Acme Corp" → "AC", "Helio" → "H". */
export const initialsOfName = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?"

const FIELD_NAMES: Readonly<Record<string, string>> = {
  firstName: "first name",
  lastName: "last name",
  emails: "emails",
  phones: "phones",
  name: "name",
  domains: "domains",
  website: "website",
  phone: "phone",
  address: "address",
  title: "title",
  avatar: "avatar",
  logo: "logo",
}

/** One activity entry in words (D111): "added Sam to this company by domain matching on acme.com". */
const describe = (entry: ActivityEntry, recordType: RecordType): ReactNode => {
  const self = recordType === "contact" ? "this contact" : "this company"
  const other = entry.related ? <b>{entry.related.name}</b> : "a record"
  const matched =
    entry.reason === "domain-matching" ? (
      <span className="src"> by domain matching{entry.matchedDomain ? ` on ${entry.matchedDomain}` : ""}</span>
    ) : null
  switch (entry.kind) {
    case "created":
      return `created ${self}`
    case "deleted":
      return `deleted ${self}`
    case "restored":
      return `restored ${self}`
    case "affiliated":
      return recordType === "contact" ? (
        <>
          added {self} to {other}
          {matched}
        </>
      ) : (
        <>
          added {other} to {self}
          {matched}
        </>
      )
    case "unaffiliated":
      return recordType === "contact" ? (
        <>
          removed {self} from {other}
        </>
      ) : (
        <>
          removed {other} from {self}
        </>
      )
    case "updated": {
      if (entry.related) {
        return recordType === "contact" ? <>changed the title at {other}</> : <>changed the title of {other}</>
      }
      const fields = entry.changedFields.map((field) => FIELD_NAMES[field] ?? field)
      return fields.length > 0 ? `changed ${fields.join(", ")}` : `edited ${self}`
    }
    case "emailed":
      return (
        <>
          sent {self} {other}
        </>
      )
    case "unsubscribed":
    case "resubscribed": {
      // From the unsubscribe link, the contact is the actor: "Ada unsubscribed from Newsletter".
      const fromLink = entry.via === "unsubscribe link"
      const what = entry.topicName ? <b>{entry.topicName}</b> : "all marketing email"
      if (entry.kind === "unsubscribed") {
        return fromLink ? (
          <>unsubscribed from {what}</>
        ) : (
          <>
            unsubscribed {self} from {what}
          </>
        )
      }
      return fromLink ? (
        <>subscribed again to {what}</>
      ) : (
        <>
          subscribed {self} again to {what}
        </>
      )
    }
    case "bounced":
      return entry.related ? (
        <>
          recorded that {other} bounced, so campaigns skip {self}
        </>
      ) : (
        `recorded a bounce`
      )
    case "marked-as-spam":
      return entry.related ? <>marked {other} as spam</> : "marked a campaign as spam"
  }
}

export function ActivityRow(props: {
  readonly entry: ActivityEntry
  readonly recordType: RecordType
  readonly first: boolean
}) {
  const { entry } = props
  return (
    <div className={`act ${props.first ? "first" : ""}`}>
      <span className="av" aria-hidden="true">
        {initialsOfName(entry.actorName)}
        {entry.via ? (
          <span className="agent">
            <AgentIcon />
          </span>
        ) : null}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="act-l">
          <b>{entry.actorName}</b>
          {entry.via ? <span className="via"> via {entry.via}</span> : null} {describe(entry, props.recordType)}
        </div>
      </div>
      <span className="when sm-t" title={absolute(entry.at)}>
        {relative(entry.at)}
      </span>
    </div>
  )
}

export function LoadFailed(props: {
  readonly title: string
  readonly message: UserText
  readonly onRetry: () => void
}) {
  return (
    <div className="center" role="alert">
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

export function EditableText(props: {
  readonly label: string
  readonly value: string | null
  readonly onSave: (value: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const id = `edit-${props.label.replace(/\s+/g, "-").toLowerCase()}`
  if (editing) {
    return (
      <div className="field">
        <label className="flabel sm-t" htmlFor={id}>
          {props.label}
        </label>
        <div className="fval" style={{ padding: "0 6px" }}>
          <input
            id={id}
            className="finp"
            defaultValue={props.value ?? ""}
            // biome-ignore lint/a11y/noAutofocus: the person just clicked this field to edit it
            autoFocus
            onBlur={(event) => {
              setEditing(false)
              const next = event.currentTarget.value.trim() || null
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
        </div>
      </div>
    )
  }
  return (
    <div className="field">
      <span className="flabel sm-t">{props.label}</span>
      <button className="fval" type="button" onClick={() => setEditing(true)}>
        {props.value ?? <span className="empty-v">Empty</span>}
      </button>
    </div>
  )
}

export function EditableList(props: {
  readonly label: string
  readonly empty: string
  readonly items: ReadonlyArray<{ readonly value: string; readonly tag: string | undefined }>
  readonly type: "email" | "tel" | "text"
  readonly onSave: (values: ReadonlyArray<string>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ReadonlyArray<string>>([])
  const begin = () => {
    setDraft([...props.items.map((item) => item.value), ""])
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    const values = draft.map((value) => value.trim()).filter(Boolean)
    const same =
      values.length === props.items.length && values.every((value, index) => value === props.items[index]?.value)
    if (!same) props.onSave(values)
  }
  if (editing) {
    return (
      <div className="field">
        <span className="flabel sm-t">{props.label}</span>
        <fieldset
          className="fval"
          style={{ padding: "0 6px", gap: 2, border: 0, minInlineSize: 0 }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit()
          }}
        >
          <legend className="vh">{props.label}</legend>
          {draft.map((value, index) => (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while editing
              key={index}
              className="finp"
              type={props.type}
              aria-label={`${props.label} ${index + 1}`}
              placeholder={index === draft.length - 1 ? props.empty : undefined}
              // biome-ignore lint/a11y/noAutofocus: the person just clicked this field to edit it
              autoFocus={index === 0}
              value={value}
              onChange={(event) => {
                const next = [...draft]
                next[index] = event.target.value
                if (index === draft.length - 1 && event.target.value) next.push("")
                setDraft(next)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit()
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setEditing(false)
                }
              }}
            />
          ))}
        </fieldset>
      </div>
    )
  }
  return (
    <div className="field">
      <span className="flabel sm-t">{props.label}</span>
      <button className="fval" type="button" onClick={begin}>
        {props.items.length === 0 ? <span className="empty-v">Empty</span> : null}
        {props.items.map((item) => (
          <span className="fline" key={item.value}>
            <span className="t">{item.value}</span>
            {item.tag ? <span className="tag sm-t">{item.tag}</span> : null}
          </span>
        ))}
      </button>
    </div>
  )
}
