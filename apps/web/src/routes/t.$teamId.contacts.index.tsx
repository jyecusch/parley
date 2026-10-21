import {
  type CompanyId,
  type Contact,
  type ContactId,
  type CustomField,
  type FieldProblem,
  filterFields,
  type Matching,
  ROLE_PERMISSIONS,
  type SegmentId,
  type Selection,
  type TeamId,
  type UserId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AffiliateDialog, AffiliationChips } from "../components/affiliations.tsx"
import { ContactPanel, type Toast } from "../components/contact-panel.tsx"
import { CustomCell } from "../components/custom-fields.tsx"
import { FilterBar } from "../components/filters.tsx"
import { CloseIcon, ContactsIcon, RestoreIcon, TrashIcon, UploadIcon } from "../components/icons.tsx"
import { ContactAvatar } from "../components/images.tsx"
import { ImportBanners, importsKey, PastImportsDialog } from "../components/imports.tsx"
import {
  DisplayMenu,
  ExportMenu,
  ImportDialog,
  SaveViewDialog,
  SetFieldDialog,
  ViewActions,
} from "../components/index-view.tsx"
import { LoadFailed, problemFor, problemsOf, toE164 } from "../components/record.tsx"
import { PlaceholderRow, SelectionCount, SpacerRow, useSelection, useVirtualRows } from "../components/record-index.tsx"
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
import { refreshCompanies } from "../lib/companies.ts"
import { contactApi, deleteContacts, refreshContacts, restoreContacts } from "../lib/contacts.ts"
import { useFields } from "../lib/custom-fields.ts"
import { download, useIndexView } from "../lib/index-view.ts"
import { usePeople, usePeopleOptions } from "../lib/people.ts"
import { patchCached, useDebounced, useRecord, useRecordList } from "../lib/records.ts"
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
  const { team } = useShell()
  const teamId = team.id as TeamId
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState<string>()
  const [toast, setToast] = useState<Toast>()
  const [dialog, setDialog] = useState<
    "save-view" | "import" | "set-field" | "affiliate" | "segment" | "past-imports"
  >()
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
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })

  // The server searches, filters and sorts, and sends a page at a time (D136).
  const searchText = useDebounced(filter.trim())
  const listParams = useMemo(
    () => ({ search: searchText, filter: indexView.state.filter, sort: indexView.state.sort }),
    [searchText, indexView.state.filter, indexView.state.sort],
  )
  const list = useRecordList(contactApi, teamId, listParams, { enabled: !search.deleted })
  const contacts = list.items
  const loadedIds = useMemo(() => contacts.map((contact) => contact.id as string), [contacts])
  const matching: Matching = useMemo(
    () => ({
      ...(searchText ? { search: searchText } : {}),
      ...(indexView.state.filter.conditions.length > 0 ? { filter: indexView.state.filter } : {}),
    }),
    [searchText, indexView.state.filter],
  )
  const selection = useSelection({ loadedIds, total: list.total, matching })
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtual = useVirtualRows({
    count: list.count,
    scrollRef,
    onRange: list.ensure,
    resetKey: JSON.stringify(listParams),
  })

  // The open contact comes from the server, so a link to one past the loaded pages works.
  const openRecord = useRecord(contactApi, teamId, search.contact)
  const open = search.contact && openRecord.data && !openRecord.data.deletedAt ? openRecord.data : undefined
  const openIndex = open ? list.indexOf(open.id) : -1

  /**
   * Exports as CSV (D62): a selection, everything matching the view, or a segment's contacts.
   */
  const exportCsv = async (
    what: { readonly selection: Selection } | { readonly matching: Matching } | { readonly segmentId: string },
  ) => {
    const segment = "segmentId" in what ? segments.data?.find((entry) => entry.id === what.segmentId) : undefined
    const scope =
      "segmentId" in what
        ? { segmentId: what.segmentId as SegmentId }
        : "matching" in what
          ? what.matching
          : "ids" in what.selection
            ? { ids: [...what.selection.ids] }
            : what.selection.matching
    try {
      const result = await call("contacts.export", { teamId, ...scope })
      const slug = segment
        ? `-${segment.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}`
        : ""
      download(`contacts${slug}-${new Date().toISOString().slice(0, 10)}.csv`, result.csv)
      showToast({ text: `Exported ${countOf(result.count)}.` })
    } catch (failure) {
      showToast({ text: messageOf(failure) })
    }
  }
  const filterRef = useRef<HTMLInputElement>(null)

  const setSearch = useCallback(
    (next: Search) => navigate({ search: { ...(search.view ? { view: search.view } : {}), ...next } }),
    [navigate, search.view],
  )

  const showToast = useCallback((next: Toast) => {
    setToast(next)
    window.setTimeout(() => setToast((current) => (current === next ? undefined : current)), 8000)
  }, [])

  /** Undoes a delete: restores what each deleteMany call deleted (D137). */
  const restore = useCallback(
    async (deletedAts: ReadonlyArray<string>) => {
      try {
        for (const deletedAt of deletedAts) await restoreContacts(queryClient, teamId, deletedAt)
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
    },
    [queryClient, showToast, teamId],
  )

  const restoreOne = useCallback(
    async (id: string) => {
      try {
        await call("contacts.restore", { teamId, contactId: id as ContactId })
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
      await refreshContacts(queryClient, teamId)
      await queryClient.invalidateQueries({ queryKey: ["contacts-deleted", teamId] })
    },
    [queryClient, showToast, teamId],
  )

  /** Deletes a selection: picked rows leave the list at once, and the toast can undo it (D137). */
  const remove = useCallback(
    async (selections: ReadonlyArray<Selection>) => {
      if (selections.length === 0) return
      selection.clear()
      const picked = selections.flatMap((entry) => ("ids" in entry ? entry.ids : []))
      if (search.contact && (picked.includes(search.contact) || selections.some((entry) => "matching" in entry))) {
        void setSearch({})
      }
      try {
        const results = []
        for (const entry of selections) results.push(await deleteContacts(queryClient, teamId, entry))
        const count = results.reduce((sum, result) => sum + result.count, 0)
        const deletedAts = results.map((result) => result.deletedAt)
        showToast({ text: `${countOf(count)} deleted`, undo: () => void restore(deletedAts) })
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
    },
    [queryClient, restore, search.contact, selection, setSearch, showToast, teamId],
  )

  /** Moves the keyboard cursor, or the open panel, through the list, loading more near its end. */
  const moveTo = useCallback(
    (index: number) => {
      // A row not loaded yet is scrolled to, which loads it; the next press moves onto it.
      virtual.scrollTo(index)
      const next = list.at(index)
      if (!next) return
      if (search.contact) void setSearch({ contact: next.id })
      else setCursor(next.id)
    },
    [list, search.contact, setSearch, virtual],
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
      const current = search.contact ?? cursor
      const index = current ? list.indexOf(current) : -1
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault()
        moveTo(index < 0 ? 0 : Math.min(index + 1, list.count - 1))
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault()
        moveTo(index < 0 ? 0 : Math.max(index - 1, 0))
      } else if (event.key === "Enter" && cursor && !search.contact) {
        void setSearch({ contact: cursor })
      } else if (event.key === "x" && cursor) {
        selection.toggle(cursor)
      } else if ((event.key === "Backspace" || event.key === "Delete") && selection.count > 0) {
        event.preventDefault()
        void remove(selection.selections())
      } else if (event.key === "/") {
        event.preventDefault()
        filterRef.current?.focus()
      } else if (event.key === "Escape") {
        if (search.contact || search.new) void setSearch({})
        else if (selection.count > 0) selection.clear()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [cursor, moveTo, remove, search, selection, setSearch, toast, list.count, list.indexOf])

  const narrowed = searchText !== "" || indexView.state.filter.conditions.length > 0
  const isLoading = list.isLoading
  const loadError = list.isError ? list.error : undefined
  const isEmpty = !isLoading && !loadError && !narrowed && list.total === 0

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
          {!search.deleted && !isLoading && !isEmpty && list.total !== null ? (
            <Count>{list.total.toLocaleString()}</Count>
          ) : null}
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
                teamId={teamId}
                fields={filterInfo}
                filter={indexView.state.filter}
                onChange={indexView.setFilter}
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
              showing={list.total ?? contacts.length}
              filtered={narrowed}
              onExportShowing={() => void exportCsv({ matching })}
              segments={segments.data ?? []}
              onExportSegment={(segmentId) => void exportCsv({ segmentId })}
            />
          </Toolbar>
        )}

        {search.deleted ? null : (
          <ImportBanners
            teamId={teamId}
            recordType="contact"
            plural="contacts"
            canWrite={canWrite}
            onRecordsChanged={() => void refreshContacts(queryClient, teamId)}
          />
        )}

        <ViewBody>
          {search.deleted ? (
            <DeletedContacts teamId={teamId} onRestore={restoreOne} />
          ) : isLoading ? (
            <LoadingRows />
          ) : loadError ? (
            <LoadFailed
              title="Contacts didn't load"
              message={messageOf(loadError)}
              onRetry={() => void list.refetch()}
            />
          ) : isEmpty ? (
            <EmptyTeam
              onNew={() => void setSearch({ new: true })}
              onImport={canWrite ? () => setDialog("import") : undefined}
            />
          ) : list.count === 0 ? (
            <Centered>
              <EmptyState title={searchText ? `No contacts match “${searchText}”` : "No contacts match these filters"}>
                {searchText ? "Try part of a name or an email address." : "Change or remove a filter to see more."}
              </EmptyState>
            </Centered>
          ) : (
            <TableScroll ref={scrollRef} padForBar={selection.count > 0} className={cn(list.isStale && "opacity-60")}>
              <Table>
                <caption className="sr-only">Contacts</caption>
                <thead>
                  <tr>
                    <Th className={checkCellClass} scope="col">
                      <Checkbox
                        reveal={selection.count === 0}
                        mixed={selection.someLoaded}
                        aria-label="Select all contacts"
                        checked={selection.allLoaded}
                        onChange={selection.toggleAllLoaded}
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
                  <SpacerRow height={virtual.before} />
                  {virtual.rows.map((row) => {
                    const contact = list.at(row.index)
                    if (!contact) return <PlaceholderRow key={`loading-${row.index}`} />
                    return (
                      <ContactRow
                        key={contact.id}
                        contact={contact}
                        checked={selection.isPicked(contact.id)}
                        revealCheckbox={selection.count === 0}
                        isOpen={open?.id === contact.id}
                        isCursor={!open && cursor === contact.id}
                        onToggle={() => selection.toggle(contact.id)}
                        onOpen={() => void setSearch({ contact: contact.id })}
                        fields={shownFields}
                        showOwner={showOwner}
                      />
                    )
                  })}
                  <SpacerRow height={virtual.after} />
                </tbody>
              </Table>
            </TableScroll>
          )}
        </ViewBody>

        {selection.count > 0 ? (
          <FloatingBar role="toolbar" aria-label="Actions on the selection">
            <SelectionCount selection={selection} total={list.total} plural="contacts" />
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void exportCsv(
                  selection.ids && selection.ids.length <= 10_000
                    ? { selection: { ids: selection.ids } }
                    : { matching },
                )
              }
            >
              Export
            </Button>
            <Tooltip text="Delete  ⌫">
              <Button variant="danger" size="sm" onClick={() => void remove(selection.selections())}>
                Delete
              </Button>
            </Tooltip>
            <FloatingBarDivider />
            <IconButton label="Clear selection" tip="Clear selection  Esc" size="xs" onClick={selection.clear}>
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
          teamId={teamId}
          canCreateTopics={ROLE_PERMISSIONS[team.role].has("email:manage")}
          recordType="contact"
          plural="contacts"
          customFields={fields}
          onClose={() => setDialog(undefined)}
          onShowPast={() => setDialog("past-imports")}
          onStarted={() => {
            setDialog(undefined)
            void queryClient.invalidateQueries({ queryKey: importsKey(teamId, "contact") })
          }}
        />
      ) : dialog === "past-imports" ? (
        <PastImportsDialog
          teamId={teamId}
          recordType="contact"
          plural="contacts"
          onClose={() => setDialog(undefined)}
        />
      ) : dialog === "set-field" ? (
        <SetFieldDialog
          count={selection.count}
          noun={selection.count === 1 ? "contact" : "contacts"}
          fields={fields}
          onClose={() => setDialog(undefined)}
          onApply={async (field, value) => {
            const selections = selection.selections()
            // Picked rows show the value at once; the server's answer then refreshes the list.
            const undo = selection.ids
              ? patchCached<Contact>(queryClient, "contacts", teamId, new Set(selection.ids), (contact) => {
                  const custom = { ...contact.custom }
                  if (value === null) delete custom[field.id]
                  else custom[field.id] = value
                  return { ...contact, custom }
                })
              : () => {}
            setDialog(undefined)
            selection.clear()
            try {
              let count = 0
              for (const entry of selections) {
                const result = await call("contacts.updateMany", {
                  teamId,
                  selection: entry,
                  custom: { [field.id]: value },
                })
                count += result.count
              }
              showToast({ text: `${field.name} is set on ${countOf(count)}.` })
            } catch (failure) {
              undo()
              showToast({ text: messageOf(failure) })
            }
            await refreshContacts(queryClient, teamId)
          }}
        />
      ) : dialog === "segment" ? (
        <AddToSegmentDialog
          teamId={teamId}
          selections={selection.selections()}
          count={selection.count}
          onClose={() => setDialog(undefined)}
          onDone={(text) => {
            setDialog(undefined)
            selection.clear()
            showToast({ text })
          }}
        />
      ) : dialog === "affiliate" ? (
        <AffiliateDialog
          teamId={teamId}
          count={selection.count}
          onClose={() => setDialog(undefined)}
          onApply={async (companyId, title) => {
            const selections = selection.selections()
            setDialog(undefined)
            try {
              let count = 0
              for (const entry of selections) {
                const result = await call("affiliations.createMany", {
                  teamId,
                  contacts: entry,
                  companyId: companyId as CompanyId,
                  ...(title ? { title } : {}),
                })
                count += result.count
              }
              selection.clear()
              showToast({ text: `${countOf(count)} added.` })
            } catch (failure) {
              showToast({ text: messageOf(failure) })
            }
            await refreshContacts(queryClient, teamId)
            await refreshCompanies(queryClient, teamId)
          }}
        />
      ) : null}
      {search.new ? (
        <CreatePanel
          teamId={teamId}
          onClose={() => void setSearch({})}
          onCreated={async (contact) => {
            await refreshContacts(queryClient, teamId)
            void setSearch({ contact: contact.id })
          }}
          onOpenExisting={(id) => void setSearch({ contact: id })}
        />
      ) : open ? (
        <ContactPanel
          key={open.id}
          contact={open}
          teamId={teamId}
          position={{ index: openIndex, total: list.total ?? contacts.length }}
          onMove={(delta) => moveTo(openIndex + delta)}
          onClose={() => void setSearch({})}
          onDelete={() => void remove([{ ids: [open.id] }])}
          onError={(text) => showToast({ text })}
          onToast={showToast}
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

const countOf = (count: number) => `${count.toLocaleString()} ${count === 1 ? "contact" : "contacts"}`

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

/** No contacts yet: add one, or bring them in from a CSV (such as another CRM's export). */
function EmptyTeam(props: { readonly onNew: () => void; readonly onImport: (() => void) | undefined }) {
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
            {props.onImport ? (
              <Button onClick={props.onImport}>
                <UploadIcon className="size-4" />
                Import a CSV
              </Button>
            ) : null}
          </>
        }
      >
        Contacts are the people your team works with. Import them from a CSV, such as another CRM's export, connect an
        agent over MCP and let it do the typing, or add them yourself.
      </EmptyState>
    </Centered>
  )
}

function DeletedContacts(props: { readonly teamId: TeamId; readonly onRestore: (id: string) => Promise<void> }) {
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
                <Button size="sm" onClick={() => void props.onRestore(contact.id)}>
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
