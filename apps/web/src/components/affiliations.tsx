import type { Affiliation, Company, CompanyId, Contact, ContactAffiliation, ContactId, TeamId } from "@parley/domain"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { companiesCollection, primaryDomainOf } from "../lib/companies.ts"
import { contactsCollection } from "../lib/contacts.ts"
import { CloseIcon, PlusIcon, SearchIcon } from "./icons.tsx"
import { initialsOfName } from "./record.tsx"
import { Dialog } from "./settings.tsx"

/** A message for the screen's toast, optionally with an undo. */
export interface ToastRequest {
  readonly text: string
  readonly undo?: () => void
}

/** After any affiliation change: contacts carry their companies, and companies count their contacts. */
const useRefreshAfterChange = (teamId: TeamId) => {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      contactsCollection(teamId, queryClient).utils.refetch(),
      companiesCollection(teamId, queryClient).utils.refetch(),
      queryClient.invalidateQueries({ queryKey: ["affiliations", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["contact-activity", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["company-activity", teamId] }),
    ])
  }
}

/** In the contacts table: up to two companies, then "+N"; titles are in the tooltip (D113). */
export function AffiliationChips(props: { readonly affiliations: ReadonlyArray<ContactAffiliation> }) {
  if (props.affiliations.length === 0) return <span className="c-none">—</span>
  const shown = props.affiliations.slice(0, 2)
  const rest = props.affiliations.slice(2)
  const label = (affiliation: ContactAffiliation) =>
    affiliation.title ? `${affiliation.companyName} · ${affiliation.title}` : affiliation.companyName
  return (
    <span className="affs">
      {shown.map((affiliation) => (
        <span key={affiliation.id} className="aff sm-t" title={label(affiliation)}>
          <span className="tile" aria-hidden="true">
            {initialsOfName(affiliation.companyName)}
          </span>
          <span className="t">{affiliation.companyName}</span>
        </span>
      ))}
      {rest.length > 0 ? (
        <span className="more" title={rest.map(label).join("\n")}>
          +{rest.length}
        </span>
      ) : null}
    </span>
  )
}

/** In the contact panel's header: each company with its title. */
export function AffiliationTags(props: { readonly affiliations: ReadonlyArray<ContactAffiliation> }) {
  if (props.affiliations.length === 0) return null
  return (
    <div className="ph-affs">
      {props.affiliations.map((affiliation) => (
        <span key={affiliation.id} className="aff sm-t">
          <span className="tile" aria-hidden="true">
            {initialsOfName(affiliation.companyName)}
          </span>
          <span className="t">{affiliation.companyName}</span>
          {affiliation.title ? <span className="ti">{affiliation.title}</span> : null}
        </span>
      ))}
    </div>
  )
}

interface PickerItem {
  readonly id: string
  readonly name: string
  readonly sub: string | undefined
  readonly avatar: ReactNode
}

/** A searchable list in a popover. Arrow keys move, Enter picks, Escape closes. */
function Picker(props: {
  readonly label: string
  readonly placeholder: string
  readonly heading: string
  readonly items: ReadonlyArray<PickerItem>
  readonly onPick: (id: string) => void
  readonly onCreate?: (name: string) => void
  readonly createLabel?: (name: string) => string
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = props
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener("pointerdown", onPointer)
    return () => document.removeEventListener("pointerdown", onPointer)
  }, [onClose])
  const q = query.trim().toLowerCase()
  const matches = props.items
    .filter((item) => !q || item.name.toLowerCase().includes(q) || item.sub?.toLowerCase().includes(q))
    .slice(0, 8)
  const canCreate = props.onCreate !== undefined && query.trim() !== ""
  const total = matches.length + (canCreate ? 1 : 0)
  const choose = (index: number) => {
    const item = matches[index]
    if (item) props.onPick(item.id)
    else if (canCreate) props.onCreate?.(query.trim())
  }
  return (
    <div className="pop" role="dialog" aria-label={props.label} ref={ref} style={{ right: 8, top: 34 }}>
      <div className="pop-in">
        <SearchIcon size={14} />
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker opens for typing
          autoFocus
          aria-label={props.placeholder}
          placeholder={props.placeholder}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, total - 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === "Enter") {
              event.preventDefault()
              choose(active)
            } else if (event.key === "Escape") {
              event.stopPropagation()
              props.onClose()
            }
          }}
        />
      </div>
      <div className="pop-list">
        <p className="pop-gh sm-t">{props.heading}</p>
        {matches.length === 0 ? <p className="pop-gh sm-t">Nothing matches.</p> : null}
        {matches.map((item, index) => (
          <button
            key={item.id}
            className={`pop-i ${index === active ? "on" : ""}`}
            type="button"
            onMouseEnter={() => setActive(index)}
            onClick={() => props.onPick(item.id)}
          >
            {item.avatar}
            <span>{item.name}</span>
            {item.sub ? <span className="s sm-t">{item.sub}</span> : null}
          </button>
        ))}
      </div>
      {canCreate ? (
        <div className="pop-f">
          <button
            className={`pop-i ${active === matches.length ? "on" : ""}`}
            type="button"
            onMouseEnter={() => setActive(matches.length)}
            onClick={() => props.onCreate?.(query.trim())}
          >
            <span className="ic">
              <PlusIcon size={14} />
            </span>
            <span>{props.createLabel?.(query.trim())}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The contact panel's Companies section: each company with its title, editable, removable, and a picker. */
export function ContactCompanies(props: {
  readonly contact: Contact
  readonly teamId: TeamId
  readonly onToast: (toast: ToastRequest) => void
}) {
  const { contact, teamId } = props
  const queryClient = useQueryClient()
  const refresh = useRefreshAfterChange(teamId)
  const companies = companiesCollection(teamId, queryClient)
  const all = useLiveQuery((q) => q.from({ company: companies }), [companies])
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string>()

  const affiliate = async (companyId: CompanyId, title: string | null) => {
    await call("affiliations.create", { teamId, contactId: contact.id, companyId, ...(title ? { title } : {}) })
    await refresh()
  }

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (failure) {
      props.onToast({ text: messageOf(failure) })
      await refresh()
    }
  }

  const items = useMemo(() => {
    const linked = new Set(contact.affiliations.map((affiliation) => affiliation.companyId))
    return [...(all.data ?? [])]
      .filter((company: Company) => !linked.has(company.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (company): PickerItem => ({
          id: company.id,
          name: company.name,
          sub: primaryDomainOf(company),
          avatar: (
            <span className="tile" aria-hidden="true">
              {initialsOfName(company.name)}
            </span>
          ),
        }),
      )
  }, [all.data, contact.affiliations])

  return (
    <section className="sec" style={{ position: "relative" }}>
      <h3 className="sec-h split sm-t">
        <span>
          Companies<span className="n">{contact.affiliations.length || ""}</span>
        </span>
        <button
          className="linkish sm-t"
          type="button"
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <PlusIcon size={12} />
          Add to company
        </button>
      </h3>
      {contact.affiliations.length === 0 ? <p className="empty-v sm-t">Not affiliated with a company.</p> : null}
      {contact.affiliations.map((affiliation) =>
        editing === affiliation.id ? (
          <TitleEditor
            key={affiliation.id}
            name={affiliation.companyName}
            title={affiliation.title}
            onCancel={() => setEditing(undefined)}
            onSave={(title) => {
              setEditing(undefined)
              void run(async () => {
                await call("affiliations.update", { teamId, affiliationId: affiliation.id, title })
                await refresh()
              })
            }}
          />
        ) : (
          <div className="arow" key={affiliation.id}>
            <span className="tile md" aria-hidden="true">
              {initialsOfName(affiliation.companyName)}
            </span>
            <Link
              className="who"
              to="/t/$teamId/companies"
              params={{ teamId }}
              search={{ company: affiliation.companyId }}
            >
              <span className="n">{affiliation.companyName}</span>
              <span className="ti sm-t">{affiliation.title ?? "No title"}</span>
            </Link>
            <span className="acts">
              <button
                className="ibtn xs tip tip-b"
                type="button"
                aria-label={`Edit title at ${affiliation.companyName}`}
                data-tip="Edit title"
                onClick={() => setEditing(affiliation.id)}
              >
                <PencilIcon />
              </button>
              <button
                className="ibtn xs tip tip-b"
                type="button"
                aria-label={`Remove from ${affiliation.companyName}`}
                data-tip={`Remove from ${affiliation.companyName}`}
                onClick={() =>
                  void run(async () => {
                    await call("affiliations.delete", { teamId, affiliationId: affiliation.id })
                    await refresh()
                    // Removal is immediate with an undo (D112); undoing affiliates again with the same title.
                    props.onToast({
                      text: `${contact.displayName} removed from ${affiliation.companyName}.`,
                      undo: () => void run(() => affiliate(affiliation.companyId, affiliation.title)),
                    })
                  })
                }
              >
                <CloseIcon size={12} />
              </button>
            </span>
          </div>
        ),
      )}
      {picking ? (
        <Picker
          label={`Add ${contact.displayName} to a company`}
          placeholder="Search companies…"
          heading="Companies"
          items={items}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false)
            void run(() => affiliate(id as CompanyId, null))
          }}
          onCreate={(name) => {
            setPicking(false)
            void run(async () => {
              const company = await call("companies.create", { teamId, name })
              await affiliate(company.id, null)
            })
          }}
          createLabel={(name) => `Create company “${name}”`}
        />
      ) : null}
    </section>
  )
}

/** The company panel's Contacts section: each affiliated contact with its title, removable, and a picker. */
export function CompanyContacts(props: {
  readonly company: Company
  readonly teamId: TeamId
  readonly onToast: (toast: ToastRequest) => void
}) {
  const { company, teamId } = props
  const queryClient = useQueryClient()
  const refresh = useRefreshAfterChange(teamId)
  const contacts = contactsCollection(teamId, queryClient)
  const all = useLiveQuery((q) => q.from({ contact: contacts }), [contacts])
  const [picking, setPicking] = useState(false)
  const affiliations = useQuery({
    queryKey: ["affiliations", teamId, company.id, company.contactCount],
    queryFn: () => call("affiliations.list", { teamId, companyId: company.id }),
  })

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (failure) {
      props.onToast({ text: messageOf(failure) })
      await refresh()
    }
  }

  const affiliate = async (contactId: ContactId, title: string | null) => {
    await call("affiliations.create", { teamId, contactId, companyId: company.id, ...(title ? { title } : {}) })
    await refresh()
  }

  const rows = affiliations.data ?? []
  const items = useMemo(() => {
    const linked = new Set(rows.map((affiliation) => affiliation.contactId as string))
    return [...(all.data ?? [])]
      .filter((contact: Contact) => !linked.has(contact.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(
        (contact): PickerItem => ({
          id: contact.id,
          name: contact.displayName,
          sub: contact.emails[0]?.address,
          avatar: (
            <span className="av" aria-hidden="true">
              {initialsOfName(contact.displayName)}
            </span>
          ),
        }),
      )
  }, [all.data, rows])

  return (
    <section className="sec" style={{ position: "relative" }}>
      <h3 className="sec-h split sm-t">
        <span>
          Contacts<span className="n">{rows.length || ""}</span>
        </span>
        <button
          className="linkish sm-t"
          type="button"
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <PlusIcon size={12} />
          Add contact
        </button>
      </h3>
      {affiliations.isLoading ? <div className="sk" style={{ width: "60%", margin: "8px 0" }} /> : null}
      {affiliations.isError ? <p className="ferr sm-t">{messageOf(affiliations.error)}</p> : null}
      {affiliations.isSuccess && rows.length === 0 ? (
        <p className="empty-v sm-t">No contacts yet. Contacts with an email at its domains join on their own.</p>
      ) : null}
      {rows.map((affiliation: Affiliation) => (
        <div className="arow" key={affiliation.id}>
          <span className="av" aria-hidden="true">
            {initialsOfName(affiliation.contactName)}
          </span>
          <Link
            className="who"
            to="/t/$teamId/contacts"
            params={{ teamId }}
            search={{ contact: affiliation.contactId }}
          >
            <span className="n">{affiliation.contactName}</span>
            {affiliation.title ? <span className="ti sm-t">{affiliation.title}</span> : null}
          </Link>
          <span className="acts">
            <button
              className="ibtn xs tip tip-b"
              type="button"
              aria-label={`Remove ${affiliation.contactName} from ${company.name}`}
              data-tip={`Remove from ${company.name}`}
              onClick={() =>
                void run(async () => {
                  await call("affiliations.delete", { teamId, affiliationId: affiliation.id })
                  await refresh()
                  props.onToast({
                    text: `${affiliation.contactName} removed from ${company.name}.`,
                    undo: () => void run(() => affiliate(affiliation.contactId, affiliation.title)),
                  })
                })
              }
            >
              <CloseIcon size={12} />
            </button>
          </span>
        </div>
      ))}
      {picking ? (
        <Picker
          label={`Add a contact to ${company.name}`}
          placeholder="Search contacts…"
          heading="Contacts"
          items={items}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false)
            void run(() => affiliate(id as ContactId, null))
          }}
        />
      ) : null}
    </section>
  )
}

function TitleEditor(props: {
  readonly name: string
  readonly title: string | null
  readonly onSave: (title: string | null) => void
  readonly onCancel: () => void
}) {
  const [value, setValue] = useState(props.title ?? "")
  const save = () => {
    const next = value.trim() || null
    if (next === props.title) props.onCancel()
    else props.onSave(next)
  }
  return (
    <div className="arow editing">
      <span className="tile md" aria-hidden="true">
        {initialsOfName(props.name)}
      </span>
      <span className="who" style={{ gap: 3, padding: "4px 0" }}>
        <span className="n">{props.name}</span>
        <input
          className="tinp"
          aria-label={`Title at ${props.name}`}
          placeholder="Title, like CTO"
          maxLength={100}
          // biome-ignore lint/a11y/noAutofocus: the person just asked to edit this title
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save()
            if (event.key === "Escape") {
              event.stopPropagation()
              props.onCancel()
            }
          }}
        />
      </span>
      <span className="acts">
        <button className="btn sm primary" type="button" onClick={save}>
          Save
        </button>
      </span>
    </div>
  )
}

const PencilIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
)

/** Bulk "affiliate with a company" for selected contacts (D71). */
export function AffiliateDialog(props: {
  readonly count: number
  readonly companies: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly onApply: (companyId: string, title: string | null) => Promise<void>
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [companyId, setCompanyId] = useState<string>()
  const [title, setTitle] = useState("")
  const q = query.trim().toLowerCase()
  const matches = props.companies.filter((company) => !q || company.label.toLowerCase().includes(q)).slice(0, 50)
  return (
    <Dialog
      title={`Add ${props.count} ${props.count === 1 ? "contact" : "contacts"} to a company`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!companyId}
            onClick={() => companyId && void props.onApply(companyId, title.trim() || null)}
          >
            Add to company
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="affiliate-search">
          Company
        </label>
        <input
          id="affiliate-search"
          className="inp"
          type="text"
          placeholder="Search companies…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="box" style={{ maxHeight: 200, overflow: "auto", padding: 4 }}>
          {matches.length === 0 ? (
            <p className="hint sm-t" style={{ padding: 6 }}>
              No companies match.
            </p>
          ) : null}
          {matches.map((company) => (
            <button
              key={company.id}
              className={`pop-i ${companyId === company.id ? "on" : ""}`}
              type="button"
              onClick={() => setCompanyId(company.id)}
            >
              <span className="tile" aria-hidden="true">
                {initialsOfName(company.label)}
              </span>
              <span>{company.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fld">
        <label className="fl" htmlFor="affiliate-title">
          Title <span className="c-muted">(optional)</span>
        </label>
        <input
          id="affiliate-title"
          className="inp"
          type="text"
          maxLength={100}
          placeholder="Title, like CTO"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
    </Dialog>
  )
}
