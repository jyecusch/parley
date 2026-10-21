import type { ActivityEntry, FieldProblem, RecordType } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { type ReactNode, useState } from "react"
import { isApiFailure } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"
import {
  AgentIcon,
  AlertIcon,
  ChevronDown,
  ChevronUp,
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  MoreIcon,
} from "./icons.tsx"
import { Button as ButtonPrimitive } from "./ui/button.tsx"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx"
import {
  Avatar,
  Button,
  Centered,
  cn,
  EmptyState,
  IconButton,
  InlineInput,
  PropertyRow,
  propertyValueClass,
  RecordTitle,
  Spacer,
} from "./ui/index.ts"

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
      <span className="text-subtle"> by domain matching{entry.matchedDomain ? ` on ${entry.matchedDomain}` : ""}</span>
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
      const fields = entry.changedFields.map((field) =>
        // The record owner reads by record type (D123): never a bare "owner", which is a role.
        field === "ownerId" ? `${recordType} owner` : (FIELD_NAMES[field] ?? field),
      )
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
          recorded that {other} bounced, so broadcasts skip {self}
        </>
      ) : (
        `recorded a bounce`
      )
    case "marked-as-spam":
      return entry.related ? <>marked {other} as spam</> : "marked a broadcast as spam"
  }
}

/**
 * One entry in a record's timeline: who, what, and when, joined to the entry above by a line.
 * `aside` sits on the right, after the time.
 */
export function TimelineRow(props: {
  readonly actorName: string
  readonly via: string | null | undefined
  readonly first: boolean
  readonly at: string
  readonly children: ReactNode
  readonly body?: ReactNode
  readonly aside?: ReactNode
}) {
  return (
    <div
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 py-1.5",
        !props.first &&
          "before:absolute before:-top-1.5 before:left-2.75 before:h-3 before:w-px before:bg-line-strong before:content-['']",
      )}
    >
      <Avatar badge={props.via ? <AgentIcon /> : undefined}>{initialsOfName(props.actorName)}</Avatar>
      <div className="min-w-0">
        <div className="text-pretty text-muted [&_b]:font-medium [&_b]:text-fg">
          <b>{props.actorName}</b>
          {props.via ? <span className="text-subtle"> via {props.via}</span> : null} {props.children}
        </div>
        {props.body}
      </div>
      <span className="flex items-start gap-0.5 pt-0.5 text-sm whitespace-nowrap text-subtle tabular-nums">
        <span title={absolute(props.at)}>{relative(props.at)}</span>
        {props.aside}
      </span>
    </div>
  )
}

export function ActivityRow(props: {
  readonly entry: ActivityEntry
  readonly recordType: RecordType
  readonly first: boolean
}) {
  const { entry } = props
  return (
    <TimelineRow actorName={entry.actorName} via={entry.via} first={props.first} at={entry.at}>
      {describe(entry, props.recordType)}
    </TimelineRow>
  )
}

export function LoadFailed(props: {
  readonly title: string
  readonly message: UserText
  readonly onRetry: () => void
}) {
  return (
    <Centered role="alert">
      <EmptyState
        tone="danger"
        icon={<AlertIcon />}
        title={props.title}
        actions={
          <Button variant="primary" onClick={props.onRetry}>
            Try again
          </Button>
        }
      >
        {props.message}
      </EmptyState>
    </Centered>
  )
}

/**
 * The bar at the top of a record panel: previous and next, the position in the list, the full
 * page toggle, a menu of more actions, and close.
 */
export function PanelBar(props: {
  readonly noun: "contact" | "company"
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly layout: "panel" | "full" | undefined
  readonly onToggleLayout: (() => void) | undefined
  readonly onClose: () => void
  /** The More menu's items (DropdownMenuItem); `closeMenu` closes it, for items that don't on their own. */
  readonly menu: (closeMenu: () => void) => ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const full = props.layout === "full"
  return (
    <div className="-ml-1.5 flex items-center">
      <IconButton label={`Previous ${props.noun}`} tip="Previous  K" onClick={() => props.onMove(-1)}>
        <ChevronUp />
      </IconButton>
      <IconButton label={`Next ${props.noun}`} tip="Next  J" onClick={() => props.onMove(1)}>
        <ChevronDown className="size-5" />
      </IconButton>
      {/* A record opened from a link may be past the loaded pages (D136); then there's no position. */}
      {props.position.index >= 0 ? (
        <span className="ml-1 text-sm text-subtle tabular-nums">
          {(props.position.index + 1).toLocaleString()} of {props.position.total.toLocaleString()}
        </span>
      ) : null}
      <Spacer />
      {props.onToggleLayout ? (
        <IconButton
          label={full ? "Back to the panel" : "Open full page"}
          tip={full ? "Back to the list" : "Open full page"}
          onClick={props.onToggleLayout}
        >
          {full ? <CollapseIcon /> : <ExpandIcon />}
        </IconButton>
      ) : null}
      <div className="relative">
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <IconButton label="More actions" tip="More">
                <MoreIcon />
              </IconButton>
            }
          />
          <DropdownMenuContent align="end">{props.menu(() => setMenuOpen(false))}</DropdownMenuContent>
        </DropdownMenu>
      </div>
      <IconButton label="Close panel" tip="Close  Esc" onClick={props.onClose}>
        <CloseIcon />
      </IconButton>
    </div>
  )
}

/** A record's mark, name and a line under it, at the top of its panel. */
export function PanelIdentity(props: {
  readonly mark: ReactNode
  readonly name: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      {props.mark}
      <div className="flex min-w-0 flex-col gap-1.5">
        <RecordTitle>{props.name}</RecordTitle>
        {props.children}
      </div>
    </div>
  )
}

/** The line under a record's name in its panel, such as its email. */
export function PanelSubtitle(props: { readonly children: ReactNode }) {
  return <p className="m-0 text-sm text-muted">{props.children}</p>
}

/** How an empty property reads. */
export const EmptyValue = () => <span className="text-subtle">Empty</span>

/** One line of a list property, such as an email with its "Primary" tag. */
export function ValueLine(props: { readonly value: ReactNode; readonly tag?: string | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{props.value}</span>
      {props.tag ? <span className="text-sm text-subtle">{props.tag}</span> : null}
    </span>
  )
}

/** The classes for a fieldset that edits a property in place. */
export const propertyFieldsetClass = "m-0 flex min-w-0 flex-col gap-0.5 border-0 p-0"

export function EditableText(props: {
  readonly label: string
  readonly value: string | null
  readonly onSave: (value: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const id = `edit-${props.label.replace(/\s+/g, "-").toLowerCase()}`
  if (editing) {
    return (
      <PropertyRow label={props.label} htmlFor={id}>
        <InlineInput
          id={id}
          defaultValue={props.value ?? ""}
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
      </PropertyRow>
    )
  }
  return (
    <PropertyRow label={props.label}>
      <ButtonPrimitive variant={null} size="none" className={propertyValueClass} onClick={() => setEditing(true)}>
        {props.value ?? <EmptyValue />}
      </ButtonPrimitive>
    </PropertyRow>
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
      <PropertyRow label={props.label}>
        <fieldset
          className={propertyFieldsetClass}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit()
          }}
        >
          <legend className="sr-only">{props.label}</legend>
          {draft.map((value, index) => (
            <InlineInput
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while editing
              key={index}
              type={props.type}
              aria-label={`${props.label} ${index + 1}`}
              placeholder={index === draft.length - 1 ? props.empty : undefined}
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
      </PropertyRow>
    )
  }
  return (
    <PropertyRow label={props.label}>
      <ButtonPrimitive variant={null} size="none" className={propertyValueClass} onClick={begin}>
        {props.items.length === 0 ? <EmptyValue /> : null}
        {props.items.map((item) => (
          <ValueLine key={item.value} value={item.value} tag={item.tag} />
        ))}
      </ButtonPrimitive>
    </PropertyRow>
  )
}
