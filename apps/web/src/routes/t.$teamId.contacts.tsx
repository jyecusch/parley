import {
  type CompanyId,
  type Contact,
  type ContactId,
  type CustomField,
  contactFieldReader,
  type FieldProblem,
  filterFields,
  matchesFilter,
  ROLE_PERMISSIONS,
  type TeamId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AffiliateDialog, AffiliationChips, AffiliationTags, ContactCompanies } from "../components/affiliations.tsx"
import { CustomCell, CustomFieldsSection } from "../components/custom-fields.tsx"
import { FilterBar } from "../components/filters.tsx"
import {
  ChevronDown,
  ChevronUp,
  CloseIcon,
  ContactsIcon,
  MoreIcon,
  RestoreIcon,
  TrashIcon,
} from "../components/icons.tsx"
import { DisplayMenu, ImportDialog, SaveViewDialog, SetFieldDialog, ViewActions } from "../components/index-view.tsx"
import {
  EditableList,
  EditableText,
  LoadFailed,
  problemFor,
  problemsOf,
  toE164,
  toggle,
} from "../components/record.tsx"
import { isTyping, useShell } from "../components/shell.tsx"
import { Timeline } from "../components/timeline.tsx"
import { call, isApiFailure, messageOf } from "../lib/client.ts"
import { companiesCollection } from "../lib/companies.ts"
import { contactsCollection, displayNameOf, initialsOf } from "../lib/contacts.ts"
import { useFields } from "../lib/custom-fields.ts"
import { compareBy, download, useIndexView } from "../lib/index-view.ts"
import { absolute, relative } from "../lib/time.ts"

const teamRoute = getRouteApi("/t/$teamId")

export interface Search {
  readonly contact?: string
  readonly new?: boolean
  readonly deleted?: boolean
  /** An open saved view (D59). */
  readonly view?: string
}

export const Route = createFileRoute("/t/$teamId/contacts")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.contact === "string" ? { contact: search.contact } : {}),
    ...(search.new === true || search.new === "true" ? { new: true } : {}),
    ...(search.deleted === true || search.deleted === "true" ? { deleted: true } : {}),
    ...(typeof search.view === "string" ? { view: search.view } : {}),
  }),
  component: ContactsScreen,
})

interface Toast {
  readonly text: string
  readonly undo?: () => void
}

function ContactsScreen() {
  const { team, openCommand } = useShell()
  const teamId = team.id as TeamId
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const collection = contactsCollection(teamId, queryClient)
  const live = useLiveQuery((q) => q.from({ contact: collection }), [collection])
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = useState<string>()
  const [toast, setToast] = useState<Toast>()
  const [dialog, setDialog] = useState<"save-view" | "import" | "set-field" | "affiliate">()
  const { fields } = useFields(teamId, "contact")
  const indexView = useIndexView(teamId, "contact", search.view)
  const filterInfo = useMemo(() => filterFields("contact", fields), [fields])
  const shownFields = fields.filter(
    (field) => indexView.state.columns.includes(`custom:${field.id}`) || indexView.state.columns.includes(field.id),
  )
  const { userId } = teamRoute.useRouteContext()
  const canWrite = ROLE_PERMISSIONS[team.role].has("records:write")
  const companyCollection = companiesCollection(teamId, queryClient)
  const companyLive = useLiveQuery((q) => q.from({ company: companyCollection }), [companyCollection])
  const companyOptions = useMemo(
    () =>
      [...(companyLive.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((company) => ({ id: company.id as string, label: company.name })),
    [companyLive.data],
  )

  /** Exports what's showing (D62): the view's filter, or just the selection. */
  const exportCsv = async (ids: ReadonlyArray<string> | undefined) => {
    try {
      const result = await call("contacts.export", {
        teamId,
        ...(ids ? { ids: [...ids] } : { filter: indexView.state.filter }),
      })
      download(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, result.csv)
      showToast({ text: `Exported ${result.count} ${result.count === 1 ? "contact" : "contacts"}.` })
    } catch (failure) {
      showToast({ text: messageOf(failure) })
    }
  }
  const filterRef = useRef<HTMLInputElement>(null)

  const contacts = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...(live.data ?? [])]
      .filter(
        (contact) =>
          !q ||
          contact.displayName.toLowerCase().includes(q) ||
          contact.emails.some((email) => email.address.includes(q)),
      )
      .filter((record) => matchesFilter(indexView.state.filter, contactFieldReader(record)))
      .sort(
        indexView.state.sort
          ? compareBy(contactFieldReader, indexView.state.sort)
          : (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      )
  }, [live.data, filter, indexView.state])

  const open = search.contact ? contacts.find((contact) => contact.id === search.contact) : undefined

  const setSearch = useCallback(
    (next: Search) => navigate({ search: { ...(search.view ? { view: search.view } : {}), ...next } }),
    [navigate, search.view],
  )

  const showToast = useCallback((next: Toast) => {
    setToast(next)
    window.setTimeout(() => setToast((current) => (current === next ? undefined : current)), 8000)
  }, [])

  const restore = useCallback(
    async (ids: ReadonlyArray<string>) => {
      try {
        for (const id of ids) await call("contacts.restore", { teamId, contactId: id as ContactId })
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
      await collection.utils.refetch()
      await queryClient.invalidateQueries({ queryKey: ["contacts-deleted", teamId] })
    },
    [collection, queryClient, showToast, teamId],
  )

  const remove = useCallback(
    (ids: ReadonlyArray<string>) => {
      if (ids.length === 0) return
      const transaction = collection.delete(ids.map((id) => id as ContactId))
      setSelected(new Set())
      if (search.contact && ids.includes(search.contact)) void setSearch({})
      const text = ids.length === 1 ? "1 contact deleted" : `${ids.length} contacts deleted`
      showToast({ text, undo: () => void restore(ids) })
      transaction.isPersisted.promise.catch((failure: unknown) => showToast({ text: messageOf(failure) }))
    },
    [collection, restore, search.contact, setSearch, showToast],
  )

  // Keyboard: j/k move, Enter opens, x selects, ⌫ deletes the selection, / filters, ⌘Z undoes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && toast?.undo && !isTyping(event)) {
        event.preventDefault()
        toast.undo()
        setToast(undefined)
        return
      }
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return
      const index = contacts.findIndex((contact) => contact.id === (open?.id ?? cursor))
      const move = (delta: number) => {
        const next = contacts[Math.min(Math.max(index + delta, 0), contacts.length - 1)]
        if (!next) return
        if (open) void setSearch({ contact: next.id })
        else setCursor(next.id)
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault()
        move(index < 0 ? 0 : 1)
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault()
        move(index < 0 ? 0 : -1)
      } else if (event.key === "Enter" && cursor && !open) {
        void setSearch({ contact: cursor })
      } else if (event.key === "x" && cursor) {
        setSelected((current) => toggle(current, cursor))
      } else if ((event.key === "Backspace" || event.key === "Delete") && selected.size > 0) {
        event.preventDefault()
        remove([...selected])
      } else if (event.key === "/") {
        event.preventDefault()
        filterRef.current?.focus()
      } else if (event.key === "Escape") {
        if (search.contact || search.new) void setSearch({})
        else if (selected.size > 0) setSelected(new Set())
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [contacts, cursor, open, remove, search, selected, setSearch, toast])

  const allChecked = contacts.length > 0 && contacts.every((contact) => selected.has(contact.id))
  const someChecked = !allChecked && contacts.some((contact) => selected.has(contact.id))

  const isLoading = live.isLoading
  const loadError = live.isError ? collection.utils.lastError : undefined
  const isEmpty = !isLoading && !loadError && (live.data?.length ?? 0) === 0

  return (
    <>
      <main className={`card main ${selected.size > 0 ? "has-sel" : ""}`}>
        <div className="hd1">
          <h1 className="crumb">
            {search.deleted ? (
              <>
                <button className="root linkish" type="button" onClick={() => void setSearch({})}>
                  Contacts
                </button>
                <span className="sep" aria-hidden="true">
                  /
                </span>
                <span>Deleted</span>
              </>
            ) : (
              <span>{indexView.view?.name ?? "Contacts"}</span>
            )}
          </h1>
          {!search.deleted && !isLoading && !isEmpty ? <span className="count">{contacts.length}</span> : null}
          <div className="spacer" />
          {search.deleted ? null : (
            <ViewActions
              viewName={indexView.view?.name}
              canDelete={
                indexView.view !== undefined &&
                (!indexView.view.shared || indexView.view.ownerUserId === userId || canWrite)
              }
              dirty={indexView.dirty}
              onReset={indexView.reset}
              onSave={() => void indexView.save().then(() => showToast({ text: "View saved." }))}
              onSaveAs={() => setDialog("save-view")}
              onDelete={() =>
                void indexView.remove().then(() => {
                  showToast({ text: "View deleted." })
                  void navigate({ search: {} })
                })
              }
            />
          )}
          {isEmpty && !search.deleted ? null : (
            <button className="btn primary" type="button" onClick={() => void setSearch({ new: true })}>
              New contact <span className="kbd on-primary">C</span>
            </button>
          )}
        </div>

        {isEmpty && !search.deleted ? null : (
          <div className="hd2">
            {search.deleted ? (
              <span className="sm-t" style={{ color: "var(--fg-subtle)", marginLeft: 7 }}>
                Deleted contacts can be restored for 30 days.
              </span>
            ) : (
              <>
                <label className="vh" htmlFor="contact-filter">
                  Filter contacts
                </label>
                <input
                  ref={filterRef}
                  id="contact-filter"
                  className="search-inp"
                  placeholder="Filter by name or email  /"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setFilter("")
                      event.currentTarget.blur()
                    }
                  }}
                />
              </>
            )}
            {search.deleted ? null : (
              <FilterBar
                fields={filterInfo}
                filter={indexView.state.filter}
                onChange={indexView.setFilter}
                companies={companyOptions}
              />
            )}
            <div className="spacer" />
            <DisplayMenu
              plural="contacts"
              fields={filterInfo}
              customFields={fields}
              sort={indexView.state.sort}
              onSort={indexView.setSort}
              columns={indexView.state.columns}
              onColumns={(columns) => void indexView.setColumns(columns)}
              showingDeleted={search.deleted === true}
              onToggleDeleted={() => void setSearch(search.deleted ? {} : { deleted: true })}
              onExport={() => void exportCsv(undefined)}
              onImport={() => setDialog("import")}
            />
          </div>
        )}

        <div className="body">
          {search.deleted ? (
            <DeletedContacts teamId={teamId} onRestore={restore} />
          ) : isLoading ? (
            <LoadingRows />
          ) : loadError ? (
            <LoadFailed
              title="Contacts didn't load"
              message={messageOf(loadError)}
              onRetry={() => void collection.utils.refetch()}
            />
          ) : isEmpty ? (
            <EmptyTeam onNew={() => void setSearch({ new: true })} onCommand={openCommand} />
          ) : contacts.length === 0 ? (
            <div className="center">
              <div className="empty">
                <h2>No contacts match “{filter}”</h2>
                <p>Try part of a name or an email address.</p>
              </div>
            </div>
          ) : (
            <div className="tablewrap">
              <table className="ctable">
                <caption className="vh">Contacts</caption>
                <thead>
                  <tr>
                    <th className="w-check c-check" scope="col">
                      <input
                        className={`cb ${someChecked ? "is-mixed" : ""}`}
                        type="checkbox"
                        aria-label="Select all contacts"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(contacts.map((c) => c.id)))}
                      />
                    </th>
                    <th className="w-name" scope="col">
                      Name
                    </th>
                    <th className="w-email col-wide" scope="col">
                      Primary email
                    </th>
                    <th className="w-cos" scope="col">
                      Companies
                    </th>
                    {shownFields.map((field) => (
                      <th key={field.id} className="w-custom col-wide" scope="col">
                        {field.name}
                      </th>
                    ))}
                    <th className="w-date col-wide" scope="col">
                      Created
                    </th>
                    <th className="w-date col-wide" scope="col">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      checked={selected.has(contact.id)}
                      isOpen={open?.id === contact.id}
                      isCursor={!open && cursor === contact.id}
                      onToggle={() => setSelected((current) => toggle(current, contact.id))}
                      onOpen={() => void setSearch({ contact: contact.id })}
                      fields={shownFields}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected.size > 0 ? (
          <div className="floatbar" role="toolbar" aria-label="Bulk actions">
            <span className="n">
              <b>{selected.size}</b> selected
            </span>
            <span className="div" />
            <button className="btn ghost sm" type="button" onClick={() => setDialog("set-field")}>
              Set field
            </button>
            <button className="btn ghost sm" type="button" onClick={() => setDialog("affiliate")}>
              Add to company
            </button>
            <button className="btn ghost sm" type="button" onClick={() => void exportCsv([...selected])}>
              Export
            </button>
            <button
              className="btn ghost sm danger tip tip-b"
              type="button"
              data-tip="Delete  ⌫"
              onClick={() => remove([...selected])}
            >
              Delete
            </button>
            <span className="div" />
            <button
              className="ibtn tip tip-b"
              type="button"
              aria-label="Clear selection"
              data-tip="Clear selection  Esc"
              style={{ width: 24, height: 24 }}
              onClick={() => setSelected(new Set())}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ) : toast ? (
          <div className="floatbar" role="status">
            <span className="n" style={{ color: "var(--fg)" }}>
              {toast.text}
            </span>
            {toast.undo ? (
              <>
                <span className="div" />
                <button
                  className="btn ghost sm"
                  type="button"
                  onClick={() => {
                    toast.undo?.()
                    setToast(undefined)
                  }}
                >
                  Undo <span className="kbd">⌘Z</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </main>

      {dialog === "save-view" ? (
        <SaveViewDialog
          canShare={canWrite}
          onClose={() => setDialog(undefined)}
          onSave={async (name, shared) => {
            const saved = await indexView.saveAs(name, shared)
            setDialog(undefined)
            void navigate({ search: { view: saved.id } })
          }}
        />
      ) : dialog === "import" ? (
        <ImportDialog
          recordType="contact"
          plural="contacts"
          customFields={fields}
          onClose={() => setDialog(undefined)}
          onImport={async (csv, mapping) => {
            const result = await call("contacts.import", { teamId, csv, mapping })
            await collection.utils.refetch()
            return result
          }}
        />
      ) : dialog === "set-field" ? (
        <SetFieldDialog
          count={selected.size}
          noun={selected.size === 1 ? "contact" : "contacts"}
          fields={fields}
          onClose={() => setDialog(undefined)}
          onApply={async (field, value) => {
            const ids = [...selected]
            const transaction = collection.update(
              ids.map((id) => id as ContactId),
              (drafts) => {
                for (const draft of drafts) {
                  const next = { ...draft.custom }
                  if (value === null) delete next[field.id]
                  else next[field.id] = value as (typeof next)[string]
                  draft.custom = next
                }
              },
            )
            setDialog(undefined)
            setSelected(new Set())
            showToast({ text: `${field.name} is set on ${ids.length} ${ids.length === 1 ? "contact" : "contacts"}.` })
            transaction.isPersisted.promise.catch((failure: unknown) => showToast({ text: messageOf(failure) }))
          }}
        />
      ) : dialog === "affiliate" ? (
        <AffiliateDialog
          count={selected.size}
          companies={companyOptions}
          onClose={() => setDialog(undefined)}
          onApply={async (companyId, title) => {
            const ids = [...selected]
            setDialog(undefined)
            try {
              for (const contactId of ids) {
                await call("affiliations.create", {
                  teamId,
                  contactId: contactId as ContactId,
                  companyId: companyId as CompanyId,
                  ...(title ? { title } : {}),
                })
              }
              setSelected(new Set())
              showToast({ text: `${ids.length} ${ids.length === 1 ? "contact" : "contacts"} added.` })
            } catch (failure) {
              showToast({ text: messageOf(failure) })
            }
            await collection.utils.refetch()
            await companyCollection.utils.refetch()
          }}
        />
      ) : null}
      {search.new ? (
        <CreatePanel
          teamId={teamId}
          onClose={() => void setSearch({})}
          onCreated={async (contact) => {
            await collection.utils.refetch()
            void setSearch({ contact: contact.id })
          }}
          onOpenExisting={(id) => void setSearch({ contact: id })}
        />
      ) : open ? (
        <ContactPanel
          key={open.id}
          contact={open}
          teamId={teamId}
          position={{ index: contacts.indexOf(open), total: contacts.length }}
          onMove={(delta) => {
            const next = contacts[contacts.indexOf(open) + delta]
            if (next) void setSearch({ contact: next.id })
          }}
          onClose={() => void setSearch({})}
          onDelete={() => remove([open.id])}
          onError={(text) => showToast({ text })}
          onToast={showToast}
          collection={collection}
        />
      ) : null}
    </>
  )
}

/** The shape TanStack DB hands to an update: the contact, writable. */
type Draft = { -readonly [K in keyof Contact]: Contact[K] }

function ContactRow(props: {
  readonly contact: Contact
  readonly checked: boolean
  readonly isOpen: boolean
  readonly isCursor: boolean
  readonly onToggle: () => void
  readonly onOpen: () => void
  readonly fields: ReadonlyArray<CustomField>
}) {
  const { contact } = props
  const email = contact.emails.find((e) => e.isPrimary)?.address ?? contact.emails[0]?.address
  const className = [
    props.checked ? "is-checked" : "",
    props.isOpen ? "is-open" : "",
    props.isCursor ? "is-cursor" : "",
  ]
    .join(" ")
    .trim()
  return (
    <tr className={className}>
      <td className="c-check">
        <input
          className="cb"
          type="checkbox"
          aria-label={`Select ${contact.displayName}`}
          checked={props.checked}
          onChange={props.onToggle}
        />
      </td>
      <td>
        <button className="namebtn" type="button" onClick={props.onOpen}>
          <span className="av" aria-hidden="true">
            {initialsOf(contact)}
          </span>
          <span className="n">{contact.displayName}</span>
        </button>
      </td>
      <td className={`col-wide ${email ? "c-email" : "c-none"}`}>{email ?? "—"}</td>
      <td>
        <AffiliationChips affiliations={contact.affiliations} />
      </td>
      {props.fields.map((field) => (
        <td key={field.id} className="col-wide c-muted">
          <CustomCell field={field} value={contact.custom[field.id]} />
        </td>
      ))}
      <td className="col-wide c-date" title={`Created ${absolute(contact.createdAt)}`}>
        {relative(contact.createdAt)}
      </td>
      <td className="col-wide c-date" title={`Updated ${absolute(contact.updatedAt)}`}>
        {relative(contact.updatedAt)}
      </td>
    </tr>
  )
}

function LoadingRows() {
  const widths = [56, 72, 48, 64, 80, 52, 68, 60, 44, 76, 58, 66]
  return (
    <div className="tablewrap" aria-busy="true">
      <span className="vh" role="status">
        Loading contacts
      </span>
      <table className="ctable" aria-hidden="true">
        <tbody>
          {widths.map((width) => (
            <tr key={width}>
              <td className="c-check w-check" />
              <td className="w-name">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="sk r" />
                  <div className="sk" style={{ width: `${width * 0.6}%` }} />
                </div>
              </td>
              <td className="w-email col-wide">
                <div className="sk" style={{ width: `${90 - width / 2}%` }} />
              </td>
              <td className="w-cos">
                <div className="sk" style={{ width: `${width * 0.5}%` }} />
              </td>
              <td className="col-wide w-date">
                <div className="sk" style={{ width: 28 }} />
              </td>
              <td className="col-wide w-date">
                <div className="sk" style={{ width: 28 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyTeam(props: { readonly onNew: () => void; readonly onCommand: () => void }) {
  return (
    <div className="center">
      <div className="empty">
        <div className="e-ic">
          <ContactsIcon />
        </div>
        <h2>No contacts yet</h2>
        <p>
          Contacts are the people your team works with. Connect an agent over MCP and let it do the typing, or add them
          yourself.
        </p>
        <div className="actions">
          <button className="btn primary" type="button" onClick={props.onNew}>
            New contact <span className="kbd on-primary">C</span>
          </button>
          <button className="btn" type="button" onClick={props.onCommand}>
            Search <span className="kbd">⌘K</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function DeletedContacts(props: {
  readonly teamId: TeamId
  readonly onRestore: (ids: ReadonlyArray<string>) => Promise<void>
}) {
  const deleted = useQuery({
    queryKey: ["contacts-deleted", props.teamId],
    queryFn: () => call("contacts.list", { teamId: props.teamId, deleted: true, limit: 200 }),
  })
  if (deleted.isLoading) return <LoadingRows />
  if (deleted.isError) {
    return (
      <LoadFailed
        title="Deleted contacts didn't load"
        message={messageOf(deleted.error)}
        onRetry={() => void deleted.refetch()}
      />
    )
  }
  const items = deleted.data?.items ?? []
  if (items.length === 0) {
    return (
      <div className="center">
        <div className="empty">
          <div className="e-ic">
            <TrashIcon />
          </div>
          <h2>Nothing deleted</h2>
          <p>Contacts you delete stay here for 30 days, so you can restore them.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="tablewrap">
      <table className="ctable">
        <caption className="vh">Deleted contacts</caption>
        <thead>
          <tr>
            <th className="w-name" scope="col" style={{ paddingLeft: 14 }}>
              Name
            </th>
            <th className="w-email" scope="col">
              Primary email
            </th>
            <th className="w-date col-wide" scope="col">
              Deleted
            </th>
            <th style={{ width: 120 }} scope="col">
              <span className="vh">Restore</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((contact) => (
            <tr key={contact.id}>
              <td style={{ paddingLeft: 14 }}>
                <span className="namebtn" style={{ cursor: "default" }}>
                  <span className="av" aria-hidden="true">
                    {initialsOf(contact)}
                  </span>
                  <span className="n">{contact.displayName}</span>
                </span>
              </td>
              <td className="c-email">{contact.emails[0]?.address ?? "—"}</td>
              <td className="col-wide c-date" title={contact.deletedAt ? absolute(contact.deletedAt) : undefined}>
                {contact.deletedAt ? relative(contact.deletedAt) : ""}
              </td>
              <td style={{ textAlign: "right" }}>
                <button className="btn sm" type="button" onClick={() => void props.onRestore([contact.id])}>
                  <RestoreIcon size={13} />
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreatePanel(props: {
  readonly teamId: TeamId
  readonly onClose: () => void
  readonly onCreated: (contact: Contact) => Promise<void>
  readonly onOpenExisting: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<ReadonlyArray<FieldProblem>>()
  const [emailTaken, setEmailTaken] = useState<{ readonly message: UserText; readonly existing: string }>()
  const [error, setError] = useState<UserText>()
  const formRef = useRef<HTMLFormElement>(null)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const form = new FormData(formRef.current ?? undefined)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const email = text("email")
    const phone = toE164(text("phone"))
    setBusy(true)
    setProblems(undefined)
    setEmailTaken(undefined)
    setError(undefined)
    try {
      const contact = await call("contacts.create", {
        teamId: props.teamId,
        ...(text("firstName") ? { firstName: text("firstName") } : {}),
        ...(text("lastName") ? { lastName: text("lastName") } : {}),
        ...(email ? { emails: [{ address: email as Contact["emails"][number]["address"] }] } : {}),
        ...(phone ? { phones: [{ number: phone as Contact["phones"][number]["number"] }] } : {}),
      })
      await props.onCreated(contact)
    } catch (failure) {
      setBusy(false)
      const fieldProblems = problemsOf(failure)
      if (fieldProblems) return setProblems(fieldProblems)
      if (isApiFailure(failure) && failure.error._tag === "ContactEmailTaken") {
        const existing = (failure.error.details as { existing?: string } | undefined)?.existing ?? ""
        return setEmailTaken({ message: failure.error.userMessage, existing })
      }
      setError(messageOf(failure))
    }
  }

  const fields: ReadonlyArray<{ name: string; label: string; field: string; type?: string; autoFocus?: boolean }> = [
    { name: "firstName", label: "First name", field: "firstName", autoFocus: true },
    { name: "lastName", label: "Last name", field: "lastName" },
    { name: "email", label: "Email", field: "emails.0.address", type: "email" },
    { name: "phone", label: "Phone", field: "phones.0.number", type: "tel" },
  ]

  return (
    <aside className="card panel" aria-label="New contact">
      <div className="ph">
        <div className="ph-bar">
          <span className="pos sm-t" style={{ marginLeft: 6 }}>
            New contact
          </span>
          <div className="spacer" />
          <button
            className="ibtn tip tip-b"
            type="button"
            aria-label="Close panel"
            data-tip="Close  Esc"
            onClick={props.onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="ph-id">
          <span className="av lg" aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <h2 className="pname" style={{ color: "var(--fg-subtle)" }}>
              Untitled contact
            </h2>
            <p className="paff sm-t">Only a name or an email is needed.</p>
          </div>
        </div>
      </div>
      <form
        ref={formRef}
        className="pbody"
        onSubmit={submit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit()
          if (event.key === "Escape") props.onClose()
        }}
      >
        <section className="sec">
          {fields.map((f) => {
            const message = problemFor(problems, f.field) ?? (f.name === "email" ? emailTaken?.message : undefined)
            return (
              <div className="field" key={f.name}>
                <label className="flabel sm-t" htmlFor={`nc-${f.name}`}>
                  {f.label}
                </label>
                <div className="fval" style={{ padding: "0 6px" }}>
                  <input
                    id={`nc-${f.name}`}
                    name={f.name}
                    className="finp"
                    type={f.type ?? "text"}
                    autoComplete="off"
                    placeholder="Empty"
                    // biome-ignore lint/a11y/noAutofocus: the create panel opens for typing, like a dialog
                    autoFocus={f.autoFocus}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? `nc-${f.name}-err` : undefined}
                  />
                  {message ? (
                    <p id={`nc-${f.name}-err`} className="ferr sm-t">
                      {message}{" "}
                      {f.name === "email" && emailTaken?.existing ? (
                        <button
                          className="linkish sm-t"
                          type="button"
                          onClick={() => props.onOpenExisting(emailTaken.existing)}
                        >
                          Open contact
                        </button>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })}
          {problems && !fields.some((f) => problemFor(problems, f.field)) ? (
            <p className="ferr sm-t">{problems[0]?.userMessage}</p>
          ) : null}
          {error ? (
            <p className="ferr sm-t" role="alert">
              {error}
            </p>
          ) : null}
        </section>
        <button type="submit" className="vh" tabIndex={-1}>
          Create contact
        </button>
      </form>
      <div className="pfoot">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void submit()}>
          Create contact <span className="kbd on-primary">⌘↵</span>
        </button>
        <button className="btn ghost" type="button" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </aside>
  )
}

function ContactPanel(props: {
  readonly contact: Contact
  readonly teamId: TeamId
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onError: (text: UserText) => void
  readonly onToast: (toast: Toast) => void
  readonly collection: ReturnType<typeof contactsCollection>
}) {
  const { contact, collection } = props
  const queryClient = useQueryClient()
  const { fields } = useFields(props.teamId, "contact")
  const [moreMenu, setMoreMenu] = useState(false)
  const activity = useQuery({
    queryKey: ["contact-activity", props.teamId, contact.id, contact.updatedAt, contact.affiliations.length],
    queryFn: () => call("contacts.activity", { teamId: props.teamId, contactId: contact.id }),
  })

  const save = (change: (draft: Draft) => void) => {
    const transaction = collection.update(contact.id, (draft) => {
      change(draft as Draft)
      const primary = draft.emails.find((email) => email.isPrimary)?.address ?? draft.emails[0]?.address
      draft.displayName = displayNameOf(draft.firstName, draft.lastName, primary)
    })
    transaction.isPersisted.promise
      .then(() => queryClient.invalidateQueries({ queryKey: ["contact-activity", props.teamId, contact.id] }))
      .catch((failure: unknown) => props.onError(messageOf(failure)))
  }

  return (
    <aside className="card panel" aria-label={`Contact ${contact.displayName}`}>
      <div className="ph">
        <div className="ph-bar">
          <button
            className="ibtn tip tip-b"
            type="button"
            aria-label="Previous contact"
            data-tip="Previous  K"
            onClick={() => props.onMove(-1)}
          >
            <ChevronUp />
          </button>
          <button
            className="ibtn tip tip-b"
            type="button"
            aria-label="Next contact"
            data-tip="Next  J"
            onClick={() => props.onMove(1)}
          >
            <ChevronDown size={16} />
          </button>
          <span className="pos sm-t tab">
            {props.position.index + 1} of {props.position.total}
          </span>
          <div className="spacer" />
          <div style={{ position: "relative" }}>
            <button
              className="ibtn tip tip-b"
              type="button"
              aria-label="More actions"
              data-tip="More"
              onClick={() => setMoreMenu((v) => !v)}
            >
              <MoreIcon />
            </button>
            {moreMenu ? (
              <div className="menu" style={{ right: 0, top: 30 }}>
                <button
                  className="menu-i"
                  type="button"
                  onClick={() => {
                    const email = contact.emails[0]?.address
                    if (email) void navigator.clipboard?.writeText(email)
                    setMoreMenu(false)
                  }}
                >
                  Copy email
                </button>
                <div className="menu-sep" />
                <button className="menu-i" type="button" style={{ color: "var(--danger)" }} onClick={props.onDelete}>
                  <TrashIcon size={14} />
                  Delete contact
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="ibtn tip tip-b"
            type="button"
            aria-label="Close panel"
            data-tip="Close  Esc"
            onClick={props.onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="ph-id">
          <span className="av lg" aria-hidden="true">
            {initialsOf(contact)}
          </span>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 className="pname">{contact.displayName}</h2>
            {contact.affiliations.length > 0 ? (
              <AffiliationTags affiliations={contact.affiliations} />
            ) : (
              <p className="paff sm-t">{contact.emails[0]?.address ?? "No email"}</p>
            )}
          </div>
        </div>
      </div>
      <div className="pbody">
        <section className="sec">
          <EditableText
            label="First name"
            value={contact.firstName}
            onSave={(value) =>
              save((draft) => {
                draft.firstName = value
              })
            }
          />
          <EditableText
            label="Last name"
            value={contact.lastName}
            onSave={(value) =>
              save((draft) => {
                draft.lastName = value
              })
            }
          />
          <EditableList
            label="Emails"
            empty="Add email"
            items={contact.emails.map((email) => ({
              value: email.address,
              tag: email.isPrimary && contact.emails.length > 1 ? "Primary" : undefined,
            }))}
            type="email"
            onSave={(values) =>
              save((draft) => {
                draft.emails = values.map((address, index) => ({
                  address: address.toLowerCase() as Contact["emails"][number]["address"],
                  isPrimary: index === 0,
                }))
              })
            }
          />
          <EditableList
            label="Phones"
            empty="Add phone"
            items={contact.phones.map((phone) => ({ value: phone.number, tag: phone.label ?? undefined }))}
            type="tel"
            onSave={(values) =>
              save((draft) => {
                draft.phones = values.map((value, index) => ({
                  number: toE164(value) as Contact["phones"][number]["number"],
                  label: contact.phones[index]?.label ?? null,
                }))
              })
            }
          />
        </section>
        <CustomFieldsSection
          fields={fields}
          values={contact.custom}
          onSave={(field, value) =>
            save((draft) => {
              const next = { ...draft.custom }
              if (value === null) delete next[field.id]
              else next[field.id] = value
              draft.custom = next
            })
          }
        />
        <ContactCompanies contact={contact} teamId={props.teamId} onToast={props.onToast} />
        <Timeline
          teamId={props.teamId}
          recordType="contact"
          recordId={contact.id}
          activity={activity.data}
          activityLoading={activity.isLoading}
          activityError={activity.isError ? messageOf(activity.error) : undefined}
          onError={(text) => props.onError(text)}
        />
      </div>
    </aside>
  )
}
