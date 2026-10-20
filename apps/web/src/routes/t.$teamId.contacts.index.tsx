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
  type SegmentId,
  type TeamId,
  type UserId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AffiliateDialog, AffiliationChips } from "../components/affiliations.tsx"
import { ContactPanel, type Toast } from "../components/contact-panel.tsx"
import { CustomCell } from "../components/custom-fields.tsx"
import { FilterBar } from "../components/filters.tsx"
import { CloseIcon, ContactsIcon, RestoreIcon, TrashIcon, UploadIcon } from "../components/icons.tsx"
import { ContactAvatar } from "../components/images.tsx"
import {
  DisplayMenu,
  ExportMenu,
  ImportDialog,
  SaveViewDialog,
  SetFieldDialog,
  ViewActions,
} from "../components/index-view.tsx"
import { LoadFailed, problemFor, problemsOf, toE164, toggle } from "../components/record.tsx"
import { RecordOwnerCell, RecordOwnerField } from "../components/record-owner.tsx"
import { AddToSegmentDialog } from "../components/segments.tsx"
import { isTyping, useShell } from "../components/shell.tsx"
import {
  Avatar,
  Breadcrumb,
  BreadcrumbSeparator,
  Button,
  breadcrumbRootClass,
  Card,
  Centered,
  Checkbox,
  Count,
  cn,
  EmptyState,
  FloatingBar,
  FloatingBarDivider,
  IconButton,
  InlineInput,
  Kbd,
  PageHeader,
  PanelFooter,
  PanelHeader,
  PropertyRow,
  RecordPanel,
  RecordTitle,
  SearchInput,
  Section,
  Skeleton,
  Spacer,
  Table,
  TableScroll,
  Td,
  TextButton,
  Th,
  Toolbar,
  Tooltip,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import {
  checkCellClass,
  customColumnClass,
  dateCellClass,
  dateColumnClass,
  nameButtonClass,
  nameTextClass,
  wideColumnClass,
} from "../components/ui/record-list.tsx"
import { call, isApiFailure, messageOf } from "../lib/client.ts"
import { companiesCollection } from "../lib/companies.ts"
import { contactsCollection } from "../lib/contacts.ts"
import { useFields } from "../lib/custom-fields.ts"
import { compareBy, download, useIndexView } from "../lib/index-view.ts"
import { sortReaderOf, usePeople, usePeopleOptions } from "../lib/people.ts"
import { absolute, relative } from "../lib/time.ts"

const teamRoute = getRouteApi("/t/$teamId")

export interface Search {
  readonly contact?: string
  readonly new?: boolean
  readonly deleted?: boolean
  /** An open saved view (D59). */
  readonly view?: string
}

export const Route = createFileRoute("/t/$teamId/contacts/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.contact === "string" ? { contact: search.contact } : {}),
    ...(search.new === true || search.new === "true" ? { new: true } : {}),
    ...(search.deleted === true || search.deleted === "true" ? { deleted: true } : {}),
    ...(typeof search.view === "string" ? { view: search.view } : {}),
  }),
  component: ContactsScreen,
})

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
  const [dialog, setDialog] = useState<"save-view" | "import" | "set-field" | "affiliate" | "segment">()
  const { fields } = useFields(teamId, "contact")
  const { userId } = teamRoute.useRouteContext()
  const peopleOptions = usePeopleOptions(teamId, userId)
  const indexView = useIndexView(teamId, "contact", search.view, userId)
  const filterInfo = useMemo(() => filterFields("contact", fields), [fields])
  const showOwner = indexView.state.columns.includes("owner")
  const shownFields = fields.filter(
    (field) => indexView.state.columns.includes(`custom:${field.id}`) || indexView.state.columns.includes(field.id),
  )
  const canWrite = ROLE_PERMISSIONS[team.role].has("records:write")
  const canWriteEmail = ROLE_PERMISSIONS[team.role].has("email:write")
  const companyCollection = companiesCollection(teamId, queryClient)
  const companyLive = useLiveQuery((q) => q.from({ company: companyCollection }), [companyCollection])
  const companyOptions = useMemo(
    () =>
      [...(companyLive.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((company) => ({ id: company.id as string, label: company.name })),
    [companyLive.data],
  )

  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })

  /**
   * Exports as CSV (D62): the given contacts (what's showing, or a selection), or a segment's. More
   * than the export takes by id falls back to the view's filter.
   */
  const exportCsv = async (what: { readonly ids: ReadonlyArray<string> } | { readonly segmentId: string }) => {
    const segment = "segmentId" in what ? segments.data?.find((entry) => entry.id === what.segmentId) : undefined
    try {
      const result = await call("contacts.export", {
        teamId,
        ...("segmentId" in what
          ? { segmentId: what.segmentId as SegmentId }
          : what.ids.length <= 10_000
            ? { ids: [...what.ids] }
            : { filter: indexView.state.filter }),
      })
      const slug = segment
        ? `-${segment.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}`
        : ""
      download(`contacts${slug}-${new Date().toISOString().slice(0, 10)}.csv`, result.csv)
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
          ? compareBy(sortReaderOf(contactFieldReader), indexView.state.sort)
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
      <Card as="main" className="flex-[999_1_39rem]">
        <PageHeader>
          <Breadcrumb>
            {search.deleted ? (
              <>
                <button
                  className={cn(breadcrumbRootClass, "cursor-pointer")}
                  type="button"
                  onClick={() => void setSearch({})}
                >
                  Contacts
                </button>
                <BreadcrumbSeparator />
                <span>Deleted</span>
              </>
            ) : (
              <span>{indexView.viewName ?? "Contacts"}</span>
            )}
          </Breadcrumb>
          {!search.deleted && !isLoading && !isEmpty ? <Count>{contacts.length}</Count> : null}
          <Spacer />
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
            <Button variant="primary" onClick={() => void setSearch({ new: true })}>
              New contact <Kbd onPrimary>C</Kbd>
            </Button>
          )}
        </PageHeader>

        {isEmpty && !search.deleted ? null : (
          <Toolbar>
            {search.deleted ? (
              <span className="ml-2 text-sm text-subtle">Deleted contacts can be restored for 30 days.</span>
            ) : (
              <>
                <label className="sr-only" htmlFor="contact-filter">
                  Filter contacts
                </label>
                <SearchInput
                  // SearchInput passes its props, ref included, to its input.
                  ref={filterRef}
                  id="contact-filter"
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
                people={peopleOptions}
              />
            )}
            <Spacer />
            <DisplayMenu
              plural="contacts"
              fields={filterInfo}
              customFields={fields}
              sort={indexView.state.sort}
              onSort={indexView.setSort}
              columns={indexView.state.columns}
              onColumns={(columns) => void indexView.setColumns(columns)}
              builtInColumns={[{ ref: "owner", label: "Contact owner" }]}
              showingDeleted={search.deleted === true}
              onToggleDeleted={() => void setSearch(search.deleted ? {} : { deleted: true })}
            />
            {canWrite ? (
              <Button variant="ghost" size="sm" onClick={() => setDialog("import")}>
                <UploadIcon className="size-4" />
                Import
              </Button>
            ) : null}
            <ExportMenu
              singular="contact"
              plural="contacts"
              showing={contacts.length}
              filtered={filter.trim() !== "" || indexView.state.filter.conditions.length > 0}
              onExportShowing={() => void exportCsv({ ids: contacts.map((contact) => contact.id) })}
              segments={segments.data ?? []}
              onExportSegment={(segmentId) => void exportCsv({ segmentId })}
            />
          </Toolbar>
        )}

        <ViewBody>
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
            <Centered>
              <EmptyState title={`No contacts match “${filter}”`}>Try part of a name or an email address.</EmptyState>
            </Centered>
          ) : (
            <TableScroll padForBar={selected.size > 0}>
              <Table>
                <caption className="sr-only">Contacts</caption>
                <thead>
                  <tr>
                    <Th className={checkCellClass} scope="col">
                      <Checkbox
                        reveal={selected.size === 0}
                        mixed={someChecked}
                        aria-label="Select all contacts"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(contacts.map((c) => c.id)))}
                      />
                    </Th>
                    <Th className={NAME_COLUMN} scope="col">
                      Name
                    </Th>
                    <Th className={cn(EMAIL_COLUMN, wideColumnClass)} scope="col">
                      Primary email
                    </Th>
                    <Th className="w-[30%]" scope="col">
                      Companies
                    </Th>
                    {showOwner ? (
                      <Th className={cn(customColumnClass, wideColumnClass)} scope="col">
                        Contact owner
                      </Th>
                    ) : null}
                    {shownFields.map((field) => (
                      <Th key={field.id} className={cn(customColumnClass, wideColumnClass)} scope="col">
                        {field.name}
                      </Th>
                    ))}
                    <Th className={cn(dateColumnClass, wideColumnClass)} scope="col">
                      Created
                    </Th>
                    <Th className={cn(dateColumnClass, wideColumnClass)} scope="col">
                      Updated
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      checked={selected.has(contact.id)}
                      revealCheckbox={selected.size === 0}
                      isOpen={open?.id === contact.id}
                      isCursor={!open && cursor === contact.id}
                      onToggle={() => setSelected((current) => toggle(current, contact.id))}
                      onOpen={() => void setSearch({ contact: contact.id })}
                      fields={shownFields}
                      showOwner={showOwner}
                    />
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </ViewBody>

        {selected.size > 0 ? (
          <FloatingBar role="toolbar" aria-label="Bulk actions">
            <span className="mr-1.5 text-muted tabular-nums">
              <b className="font-medium text-fg">{selected.size}</b> selected
            </span>
            <FloatingBarDivider />
            <Button variant="ghost" size="sm" onClick={() => setDialog("set-field")}>
              Set field
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog("affiliate")}>
              Add to company
            </Button>
            {canWriteEmail ? (
              <Button variant="ghost" size="sm" onClick={() => setDialog("segment")}>
                Add to segment
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void exportCsv({ ids: [...selected] })}>
              Export
            </Button>
            <Tooltip text="Delete  ⌫">
              <Button variant="danger" size="sm" onClick={() => remove([...selected])}>
                Delete
              </Button>
            </Tooltip>
            <FloatingBarDivider />
            <IconButton
              label="Clear selection"
              tip="Clear selection  Esc"
              size="xs"
              onClick={() => setSelected(new Set())}
            >
              <CloseIcon className="size-3.5" />
            </IconButton>
          </FloatingBar>
        ) : toast ? (
          <FloatingBar role="status">
            <span className="mr-1.5 text-fg">{toast.text}</span>
            {toast.undo ? (
              <>
                <FloatingBarDivider />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    toast.undo?.()
                    setToast(undefined)
                  }}
                >
                  Undo <Kbd>⌘Z</Kbd>
                </Button>
              </>
            ) : null}
          </FloatingBar>
        ) : null}
      </Card>

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
      ) : dialog === "segment" ? (
        <AddToSegmentDialog
          teamId={teamId}
          contactIds={[...selected] as Array<ContactId>}
          onClose={() => setDialog(undefined)}
          onDone={(text) => {
            setDialog(undefined)
            setSelected(new Set())
            showToast({ text })
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
          canWrite={canWrite}
          layout="panel"
          onToggleLayout={() =>
            void navigate({ to: "/t/$teamId/contacts/$contactId", params: { teamId, contactId: open.id } })
          }
        />
      ) : null}
    </>
  )
}

/** Without the wide columns, the remaining text columns share the width. */
const NAME_COLUMN = "w-[32%] @max-3xl/content:w-auto"
const EMAIL_COLUMN = "w-[36%] @max-3xl/content:w-auto"

function ContactRow(props: {
  readonly contact: Contact
  readonly checked: boolean
  readonly revealCheckbox: boolean
  readonly isOpen: boolean
  readonly isCursor: boolean
  readonly onToggle: () => void
  readonly onOpen: () => void
  readonly fields: ReadonlyArray<CustomField>
  readonly showOwner: boolean
}) {
  const { contact } = props
  const email = contact.emails.find((e) => e.isPrimary)?.address ?? contact.emails[0]?.address
  return (
    <Tr checked={props.checked} open={props.isOpen} cursor={props.isCursor}>
      <Td className={checkCellClass}>
        <Checkbox
          reveal={props.revealCheckbox}
          aria-label={`Select ${contact.displayName}`}
          checked={props.checked}
          onChange={props.onToggle}
        />
      </Td>
      <Td>
        <button className={nameButtonClass} type="button" onClick={props.onOpen}>
          <ContactAvatar contact={contact} />
          <span className={nameTextClass}>{contact.displayName}</span>
        </button>
      </Td>
      <Td className={cn(wideColumnClass, email ? "text-muted" : "text-subtle")}>{email ?? "—"}</Td>
      <Td>
        <AffiliationChips affiliations={contact.affiliations} />
      </Td>
      {props.showOwner ? (
        <Td className={wideColumnClass}>
          <RecordOwnerCell name={contact.ownerName} />
        </Td>
      ) : null}
      {props.fields.map((field) => (
        <Td key={field.id} className={cn(wideColumnClass, "text-subtle")}>
          <CustomCell field={field} value={contact.custom[field.id]} />
        </Td>
      ))}
      <Td className={cn(wideColumnClass, dateCellClass)} title={`Created ${absolute(contact.createdAt)}`}>
        {relative(contact.createdAt)}
      </Td>
      <Td className={cn(wideColumnClass, dateCellClass)} title={`Updated ${absolute(contact.updatedAt)}`}>
        {relative(contact.updatedAt)}
      </Td>
    </Tr>
  )
}

function LoadingRows() {
  const widths = [56, 72, 48, 64, 80, 52, 68, 60, 44, 76, 58, 66]
  return (
    <TableScroll aria-busy="true">
      <span className="sr-only" role="status">
        Loading contacts
      </span>
      <Table aria-hidden="true">
        <tbody>
          {widths.map((width) => (
            <Tr key={width}>
              <Td className={checkCellClass} />
              <Td className={NAME_COLUMN}>
                <div className="flex items-center gap-2.5">
                  <Skeleton round />
                  <div style={{ width: `${width * 0.6}%` }}>
                    <Skeleton />
                  </div>
                </div>
              </Td>
              <Td className={cn(EMAIL_COLUMN, wideColumnClass)}>
                <div style={{ width: `${90 - width / 2}%` }}>
                  <Skeleton />
                </div>
              </Td>
              <Td className="w-[30%]">
                <div style={{ width: `${width * 0.5}%` }}>
                  <Skeleton />
                </div>
              </Td>
              <Td className={cn(dateColumnClass, wideColumnClass)}>
                <Skeleton className="w-8" />
              </Td>
              <Td className={cn(dateColumnClass, wideColumnClass)}>
                <Skeleton className="w-8" />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  )
}

function EmptyTeam(props: { readonly onNew: () => void; readonly onCommand: () => void }) {
  return (
    <Centered>
      <EmptyState
        icon={<ContactsIcon />}
        title="No contacts yet"
        actions={
          <>
            <Button variant="primary" onClick={props.onNew}>
              New contact <Kbd onPrimary>C</Kbd>
            </Button>
            <Button onClick={props.onCommand}>
              Search <Kbd>⌘K</Kbd>
            </Button>
          </>
        }
      >
        Contacts are the people your team works with. Connect an agent over MCP and let it do the typing, or add them
        yourself.
      </EmptyState>
    </Centered>
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
      <Centered>
        <EmptyState icon={<TrashIcon />} title="Nothing deleted">
          Contacts you delete stay here for 30 days, so you can restore them.
        </EmptyState>
      </Centered>
    )
  }
  return (
    <TableScroll>
      <Table>
        <caption className="sr-only">Deleted contacts</caption>
        <thead>
          <tr>
            <Th className={cn(NAME_COLUMN, "pl-4")} scope="col">
              Name
            </Th>
            <Th className={EMAIL_COLUMN} scope="col">
              Primary email
            </Th>
            <Th className={cn(dateColumnClass, wideColumnClass)} scope="col">
              Deleted
            </Th>
            <Th className="w-36" scope="col">
              <span className="sr-only">Restore</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {items.map((contact) => (
            <Tr key={contact.id}>
              <Td className="pl-4">
                <span className="flex min-w-0 items-center gap-2.5 font-medium">
                  <ContactAvatar contact={contact} />
                  <span className="truncate">{contact.displayName}</span>
                </span>
              </Td>
              <Td className="text-muted">{contact.emails[0]?.address ?? "—"}</Td>
              <Td
                className={cn(wideColumnClass, dateCellClass)}
                title={contact.deletedAt ? absolute(contact.deletedAt) : undefined}
              >
                {contact.deletedAt ? relative(contact.deletedAt) : ""}
              </Td>
              <Td className="text-right">
                <Button size="sm" onClick={() => void props.onRestore([contact.id])}>
                  <RestoreIcon className="size-3.5" />
                  Restore
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
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
  // A contact made here is its creator's unless they choose someone else (D123).
  const { userId } = teamRoute.useRouteContext()
  const [ownerId, setOwnerId] = useState<UserId | null>(userId as UserId)
  const people = usePeople(props.teamId).data ?? []
  const ownerName = people.find((person) => person.userId === ownerId)?.name ?? null

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
        ownerId,
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
    <RecordPanel aria-label="New contact">
      <PanelHeader>
        <div className="flex items-center">
          <span className="text-sm text-subtle">New contact</span>
          <Spacer />
          <IconButton label="Close panel" tip="Close  Esc" onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className="flex items-center gap-3">
          <Avatar size="lg" />
          <div className="min-w-0">
            <RecordTitle className="text-subtle">Untitled contact</RecordTitle>
            <p className="m-0 text-sm text-muted">Only a name or an email is needed.</p>
          </div>
        </div>
      </PanelHeader>
      <form
        ref={formRef}
        className="flex-1 overflow-auto"
        onSubmit={submit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit()
          if (event.key === "Escape") props.onClose()
        }}
      >
        <Section className="flex flex-col gap-0.5">
          {fields.map((f) => {
            const message = problemFor(problems, f.field) ?? (f.name === "email" ? emailTaken?.message : undefined)
            return (
              <PropertyRow key={f.name} label={f.label} htmlFor={`nc-${f.name}`}>
                <div className="flex min-w-0 flex-col px-1.5">
                  <InlineInput
                    id={`nc-${f.name}`}
                    name={f.name}
                    type={f.type ?? "text"}
                    autoComplete="off"
                    placeholder="Empty"
                    autoFocus={f.autoFocus}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? `nc-${f.name}-err` : undefined}
                  />
                  {message ? (
                    <p id={`nc-${f.name}-err`} className="my-1 text-sm text-danger">
                      {message}{" "}
                      {f.name === "email" && emailTaken?.existing ? (
                        <TextButton className="text-sm" onClick={() => props.onOpenExisting(emailTaken.existing)}>
                          Open contact
                        </TextButton>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </PropertyRow>
            )
          })}
          <RecordOwnerField
            teamId={props.teamId}
            label="Contact owner"
            ownerId={ownerId}
            ownerName={ownerName}
            onChange={(owner) => setOwnerId(owner?.id ?? null)}
          />
          {problems && !fields.some((f) => problemFor(problems, f.field)) ? (
            <p className="my-1 text-sm text-danger">{problems[0]?.userMessage}</p>
          ) : null}
          {error ? (
            <p className="my-1 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </Section>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Create contact
        </button>
      </form>
      <PanelFooter>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          Create contact <Kbd onPrimary>⌘↵</Kbd>
        </Button>
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
      </PanelFooter>
    </RecordPanel>
  )
}
