import {
  type Company,
  type CompanyId,
  type FieldProblem,
  filterFields,
  isFreeEmailDomain,
  type Matching,
  normalizeDomain,
  ROLE_PERMISSIONS,
  type Selection,
  type TeamId,
  type UserId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ToastRequest } from "../components/affiliations.tsx"
import {
  AddressInputs,
  addressFrom,
  CompanyPanel,
  contactsLabel,
  type Domain,
  toWebsite,
} from "../components/company-panel.tsx"
import { CustomCell } from "../components/custom-fields.tsx"
import { FilterBar } from "../components/filters.tsx"
import { CloseIcon, CompaniesIcon, PlusIcon, RestoreIcon, TrashIcon, UploadIcon } from "../components/icons.tsx"
import { CompanyLogo } from "../components/images.tsx"
import { ImportBanners, importsKey, PastImportsDialog } from "../components/imports.tsx"
import {
  DisplayMenu,
  ExportMenu,
  ImportDialog,
  SaveViewDialog,
  SetFieldDialog,
  ViewActions,
} from "../components/index-view.tsx"
import { initialsOfName, LoadFailed, problemFor, problemsOf, toE164 } from "../components/record.tsx"
import { PlaceholderRow, SelectionCount, SpacerRow, useSelection, useVirtualRows } from "../components/record-index.tsx"
import { RecordOwnerCell, RecordOwnerField } from "../components/record-owner.tsx"
import { isTyping, useShell } from "../components/shell.tsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb.tsx"
import { Button as ButtonBase } from "../components/ui/button.tsx"
import {
  Avatar,
  Button,
  Card,
  Centered,
  Checkbox,
  Count,
  cn,
  EmptyState,
  FloatingBar,
  FloatingBarDivider,
  Hint,
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
  SectionHeader,
  Skeleton,
  Spacer,
  Table,
  TableScroll,
  Td,
  TextButton,
  Th,
  Toolbar,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
import { companyApi, deleteCompanies, primaryDomainOf, refreshCompanies, restoreCompanies } from "../lib/companies.ts"
import { useFields } from "../lib/custom-fields.ts"
import { download, useIndexView } from "../lib/index-view.ts"
import { usePeople, usePeopleOptions } from "../lib/people.ts"
import { patchCached, useDebounced, useRecord, useRecordList } from "../lib/records.ts"
import { absolute, relative } from "../lib/time.ts"

const teamRoute = getRouteApi("/t/$teamId")

export interface Search {
  readonly company?: string
  readonly new?: boolean
  readonly deleted?: boolean
  /** An open saved view (D59). */
  readonly view?: string
}

export const Route = createFileRoute("/t/$teamId/companies/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.company === "string" ? { company: search.company } : {}),
    ...(search.new === true || search.new === "true" ? { new: true } : {}),
    ...(search.deleted === true || search.deleted === "true" ? { deleted: true } : {}),
    ...(typeof search.view === "string" ? { view: search.view } : {}),
  }),
  component: CompaniesScreen,
})

/** Company details that can be shown as list columns (D132); off until chosen in Display. */
const PROFILE_COLUMNS: ReadonlyArray<{
  readonly ref: string
  readonly label: string
  readonly numeric: boolean
  readonly cell: (company: Company) => string
}> = [
  { ref: "industry", label: "Industry", numeric: false, cell: (company) => company.industry ?? "" },
  {
    ref: "employees",
    label: "Employees",
    numeric: true,
    cell: (company) => (company.employees === null ? "" : company.employees.toLocaleString()),
  },
  {
    ref: "yearFounded",
    label: "Year founded",
    numeric: true,
    cell: (company) => (company.yearFounded === null ? "" : String(company.yearFounded)),
  },
  {
    ref: "annualRevenue",
    label: "Annual revenue",
    numeric: true,
    cell: (company) => (company.annualRevenue === null ? "" : company.annualRevenue.toLocaleString()),
  },
]

/** The shape TanStack DB hands to an update: the company, writable. */
function CompaniesScreen() {
  const { team } = useShell()
  const teamId = team.id as TeamId
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState<string>()
  const [toast, setToast] = useState<ToastRequest>()
  const [dialog, setDialog] = useState<"save-view" | "import" | "set-field" | "past-imports">()
  const { fields } = useFields(teamId, "company")
  const indexView = useIndexView(teamId, "company", search.view)
  const filterInfo = useMemo(() => filterFields("company", fields), [fields])
  const showOwner = indexView.state.columns.includes("owner")
  const profileColumns = PROFILE_COLUMNS.filter((column) => indexView.state.columns.includes(column.ref))
  const shownFields = fields.filter(
    (field) => indexView.state.columns.includes(`custom:${field.id}`) || indexView.state.columns.includes(field.id),
  )
  const { userId } = teamRoute.useRouteContext()
  const peopleOptions = usePeopleOptions(teamId, userId)
  const canWrite = ROLE_PERMISSIONS[team.role].has("records:write")

  // The server searches, filters and sorts, and sends a page at a time (D136).
  const searchText = useDebounced(filter.trim())
  const listParams = useMemo(
    () => ({ search: searchText, filter: indexView.state.filter, sort: indexView.state.sort }),
    [searchText, indexView.state.filter, indexView.state.sort],
  )
  const list = useRecordList(companyApi, teamId, listParams, { enabled: !search.deleted })
  const companies = list.items
  const loadedIds = useMemo(() => companies.map((company) => company.id as string), [companies])
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
    rowHeight: TALL_HEIGHT,
  })

  // The open company comes from the server, so a link to one past the loaded pages works.
  const openRecord = useRecord(companyApi, teamId, search.company)
  const open = search.company && openRecord.data && !openRecord.data.deletedAt ? openRecord.data : undefined
  const openIndex = open ? list.indexOf(open.id) : -1

  /** Exports as CSV (D62): a selection, or everything matching the view. */
  const exportCsv = async (what: { readonly selection: Selection } | { readonly matching: Matching }) => {
    const scope =
      "matching" in what
        ? what.matching
        : "ids" in what.selection
          ? { ids: [...what.selection.ids] }
          : what.selection.matching
    try {
      const result = await call("companies.export", { teamId, ...scope })
      download(`companies-${new Date().toISOString().slice(0, 10)}.csv`, result.csv)
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

  const showToast = useCallback((next: ToastRequest) => {
    setToast(next)
    window.setTimeout(() => setToast((current) => (current === next ? undefined : current)), 8000)
  }, [])

  /** Undoes a delete: restores what each deleteMany call deleted (D137). */
  const restore = useCallback(
    async (deletedAts: ReadonlyArray<string>) => {
      try {
        for (const deletedAt of deletedAts) await restoreCompanies(queryClient, teamId, deletedAt)
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
    },
    [queryClient, showToast, teamId],
  )

  const restoreOne = useCallback(
    async (id: string) => {
      try {
        await call("companies.restore", { teamId, companyId: id as CompanyId })
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
      await refreshCompanies(queryClient, teamId)
      await queryClient.invalidateQueries({ queryKey: ["companies-deleted", teamId] })
    },
    [queryClient, showToast, teamId],
  )

  /** Deletes a selection: picked rows leave the list at once, and the toast can undo it (D137). */
  const remove = useCallback(
    async (selections: ReadonlyArray<Selection>) => {
      if (selections.length === 0) return
      selection.clear()
      const picked = selections.flatMap((entry) => ("ids" in entry ? entry.ids : []))
      if (search.company && (picked.includes(search.company) || selections.some((entry) => "matching" in entry))) {
        void setSearch({})
      }
      try {
        const results = []
        for (const entry of selections) results.push(await deleteCompanies(queryClient, teamId, entry))
        const count = results.reduce((sum, result) => sum + result.count, 0)
        const deletedAts = results.map((result) => result.deletedAt)
        showToast({ text: `${countOf(count)} deleted`, undo: () => void restore(deletedAts) })
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
    },
    [queryClient, restore, search.company, selection, setSearch, showToast, teamId],
  )

  /** Moves the keyboard cursor, or the open panel, through the list, loading more near its end. */
  const moveTo = useCallback(
    (index: number) => {
      // A row not loaded yet is scrolled to, which loads it; the next press moves onto it.
      virtual.scrollTo(index)
      const next = list.at(index)
      if (!next) return
      if (search.company) void setSearch({ company: next.id })
      else setCursor(next.id)
    },
    [list, search.company, setSearch, virtual],
  )

  // Keyboard, as on Contacts: j/k move, Enter opens, x selects, ⌫ deletes, / filters, ⌘Z undoes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && toast?.undo && !isTyping(event)) {
        event.preventDefault()
        toast.undo()
        setToast(undefined)
        return
      }
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return
      const current = search.company ?? cursor
      const index = current ? list.indexOf(current) : -1
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault()
        moveTo(index < 0 ? 0 : Math.min(index + 1, list.count - 1))
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault()
        moveTo(index < 0 ? 0 : Math.max(index - 1, 0))
      } else if (event.key === "Enter" && cursor && !search.company) {
        void setSearch({ company: cursor })
      } else if (event.key === "x" && cursor) {
        selection.toggle(cursor)
      } else if ((event.key === "Backspace" || event.key === "Delete") && selection.count > 0) {
        event.preventDefault()
        void remove(selection.selections())
      } else if (event.key === "/") {
        event.preventDefault()
        filterRef.current?.focus()
      } else if (event.key === "Escape") {
        if (search.company || search.new) void setSearch({})
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
            <BreadcrumbList>
              {search.deleted ? (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      className="cursor-pointer"
                      render={<button type="button" onClick={() => void setSearch({})} />}
                    >
                      Companies
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage render={(props) => <h1 {...props} />}>Deleted</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem>
                  <BreadcrumbPage render={(props) => <h1 {...props} />}>
                    {indexView.view?.name ?? "Companies"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </BreadcrumbList>
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
              New company <Kbd onPrimary>C</Kbd>
            </Button>
          )}
        </PageHeader>

        {isEmpty && !search.deleted ? null : (
          <Toolbar>
            {search.deleted ? (
              <span className="ml-2 text-sm text-subtle">Deleted companies can be restored for 30 days.</span>
            ) : (
              <>
                <label className="sr-only" htmlFor="company-filter">
                  Filter companies
                </label>
                <SearchInput
                  // SearchInput passes its props, ref included, to its input.
                  ref={filterRef}
                  id="company-filter"
                  placeholder="Filter by name or domain  /"
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
              plural="companies"
              fields={filterInfo}
              customFields={fields}
              sort={indexView.state.sort}
              onSort={indexView.setSort}
              columns={indexView.state.columns}
              onColumns={(columns) => void indexView.setColumns(columns)}
              builtInColumns={[{ ref: "owner", label: "Company owner" }, ...PROFILE_COLUMNS]}
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
              singular="company"
              plural="companies"
              showing={list.total ?? companies.length}
              filtered={narrowed}
              onExportShowing={() => void exportCsv({ matching })}
            />
          </Toolbar>
        )}

        {search.deleted ? null : (
          <ImportBanners
            teamId={teamId}
            recordType="company"
            plural="companies"
            canWrite={canWrite}
            onRecordsChanged={() => void refreshCompanies(queryClient, teamId)}
          />
        )}

        <ViewBody>
          {search.deleted ? (
            <DeletedCompanies teamId={teamId} onRestore={restoreOne} />
          ) : isLoading ? (
            <LoadingRows />
          ) : loadError ? (
            <LoadFailed
              title="Companies didn't load"
              message={messageOf(loadError)}
              onRetry={() => void list.refetch()}
            />
          ) : isEmpty ? (
            <Centered>
              <EmptyState
                icon={<CompaniesIcon />}
                title="No companies yet"
                actions={
                  <>
                    <Button variant="primary" onClick={() => void setSearch({ new: true })}>
                      New company <Kbd onPrimary>C</Kbd>
                    </Button>
                    {canWrite ? (
                      <Button onClick={() => setDialog("import")}>
                        <UploadIcon className="size-4" />
                        Import a CSV
                      </Button>
                    ) : null}
                  </>
                }
              >
                Companies are the organizations your contacts work for. Give a company its domains, and contacts with an
                email there are affiliated with it on their own.
              </EmptyState>
            </Centered>
          ) : list.count === 0 ? (
            <Centered>
              <EmptyState
                title={searchText ? `No companies match “${searchText}”` : "No companies match these filters"}
              >
                {searchText ? "Try part of a name or a domain." : "Change or remove a filter to see more."}
              </EmptyState>
            </Centered>
          ) : (
            <TableScroll ref={scrollRef} padForBar={selection.count > 0} className={cn(list.isStale && "opacity-60")}>
              <Table>
                <caption className="sr-only">Companies</caption>
                <thead>
                  <tr>
                    <Th className={checkCellClass} scope="col">
                      <Checkbox
                        reveal={selection.count === 0}
                        mixed={selection.someLoaded}
                        aria-label="Select all companies"
                        checked={selection.allLoaded}
                        onChange={selection.toggleAllLoaded}
                      />
                    </Th>
                    <Th className={NAME_COLUMN} scope="col">
                      Name
                    </Th>
                    <Th className={COUNT_COLUMN} scope="col">
                      Contacts
                    </Th>
                    {showOwner ? (
                      <Th className={cn(customColumnClass, wideColumnClass)} scope="col">
                        Company owner
                      </Th>
                    ) : null}
                    {profileColumns.map((column) => (
                      <Th key={column.ref} className={cn(customColumnClass, wideColumnClass)} scope="col">
                        {column.label}
                      </Th>
                    ))}
                    {shownFields.map((field) => (
                      <Th key={field.id} className={cn(customColumnClass, wideColumnClass)} scope="col">
                        {field.name}
                      </Th>
                    ))}
                    <Th className={wideColumnClass} scope="col">
                      <span className="sr-only">Spacer</span>
                    </Th>
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
                    const company = list.at(row.index)
                    if (!company) return <PlaceholderRow key={`loading-${row.index}`} height={TALL_HEIGHT} />
                    const domain = primaryDomainOf(company)
                    return (
                      <Tr
                        key={company.id}
                        checked={selection.isPicked(company.id)}
                        open={open?.id === company.id}
                        cursor={!open && cursor === company.id}
                      >
                        <Td className={cn(checkCellClass, TALL)}>
                          <Checkbox
                            reveal={selection.count === 0}
                            aria-label={`Select ${company.name}`}
                            checked={selection.isPicked(company.id)}
                            onChange={() => selection.toggle(company.id)}
                          />
                        </Td>
                        <Td className={TALL}>
                          <ButtonBase
                            variant={null}
                            size="none"
                            className={nameButtonClass}
                            onClick={() => void setSearch({ company: company.id })}
                          >
                            <CompanyLogo company={company} size="md" />
                            <span className="flex min-w-0 flex-col">
                              <span className={nameTextClass}>{company.name}</span>
                              {domain ? (
                                <span className="truncate text-sm font-normal text-subtle">{domain}</span>
                              ) : null}
                            </span>
                          </ButtonBase>
                        </Td>
                        <Td className={cn(TALL, "tabular-nums", company.contactCount === 0 && "text-subtle")}>
                          {contactsLabel(company.contactCount)}
                        </Td>
                        {showOwner ? (
                          <Td className={cn(TALL, wideColumnClass)}>
                            <RecordOwnerCell name={company.ownerName} />
                          </Td>
                        ) : null}
                        {profileColumns.map((column) => (
                          <Td
                            key={column.ref}
                            className={cn(TALL, wideColumnClass, column.numeric && "tabular-nums", "text-subtle")}
                          >
                            {column.cell(company)}
                          </Td>
                        ))}
                        {shownFields.map((field) => (
                          <Td key={field.id} className={cn(TALL, wideColumnClass, "text-subtle")}>
                            <CustomCell field={field} value={company.custom[field.id]} />
                          </Td>
                        ))}
                        <Td className={cn(TALL, wideColumnClass)} />
                        <Td
                          className={cn(TALL, wideColumnClass, dateCellClass)}
                          title={`Created ${absolute(company.createdAt)}`}
                        >
                          {relative(company.createdAt)}
                        </Td>
                        <Td
                          className={cn(TALL, wideColumnClass, dateCellClass)}
                          title={`Updated ${absolute(company.updatedAt)}`}
                        >
                          {relative(company.updatedAt)}
                        </Td>
                      </Tr>
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
            <SelectionCount selection={selection} total={list.total} plural="companies" />
            <FloatingBarDivider />
            <Button variant="ghost" size="sm" onClick={() => setDialog("set-field")}>
              Set field
            </Button>
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="danger" size="sm" onClick={() => void remove(selection.selections())}>
                    Delete
                  </Button>
                }
              />
              <TooltipContent>{"Delete  ⌫"}</TooltipContent>
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
          recordType="company"
          plural="companies"
          customFields={fields}
          onClose={() => setDialog(undefined)}
          onShowPast={() => setDialog("past-imports")}
          onStarted={() => {
            setDialog(undefined)
            void queryClient.invalidateQueries({ queryKey: importsKey(teamId, "company") })
          }}
        />
      ) : dialog === "past-imports" ? (
        <PastImportsDialog
          teamId={teamId}
          recordType="company"
          plural="companies"
          onClose={() => setDialog(undefined)}
        />
      ) : dialog === "set-field" ? (
        <SetFieldDialog
          count={selection.count}
          noun={selection.count === 1 ? "company" : "companies"}
          fields={fields}
          onClose={() => setDialog(undefined)}
          onApply={async (field, value) => {
            const selections = selection.selections()
            // Picked rows show the value at once; the server's answer then refreshes the list.
            const undo = selection.ids
              ? patchCached<Company>(queryClient, "companies", teamId, new Set(selection.ids), (company) => {
                  const custom = { ...company.custom }
                  if (value === null) delete custom[field.id]
                  else custom[field.id] = value
                  return { ...company, custom }
                })
              : () => {}
            setDialog(undefined)
            selection.clear()
            try {
              let count = 0
              for (const entry of selections) {
                const result = await call("companies.updateMany", {
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
            await refreshCompanies(queryClient, teamId)
          }}
        />
      ) : null}
      {search.new ? (
        <CreatePanel
          teamId={teamId}
          teamName={team.name}
          onClose={() => void setSearch({})}
          onCreated={async (company) => {
            await refreshCompanies(queryClient, teamId)
            void setSearch({ company: company.id })
          }}
          onOpenExisting={(id) => void setSearch({ company: id })}
        />
      ) : open ? (
        <CompanyPanel
          key={open.id}
          company={open}
          teamId={teamId}
          position={{ index: openIndex, total: list.total ?? companies.length }}
          onMove={(delta) => moveTo(openIndex + delta)}
          onClose={() => void setSearch({})}
          onDelete={() => void remove([{ ids: [open.id] }])}
          onToast={showToast}
          canWrite={canWrite}
          layout="panel"
          onToggleLayout={() =>
            void navigate({ to: "/t/$teamId/companies/$companyId", params: { teamId, companyId: open.id } })
          }
        />
      ) : null}
    </>
  )
}

/** Company rows are taller: a name and a domain. */
const TALL = "h-12"
const TALL_HEIGHT = 48

const countOf = (count: number) => `${count.toLocaleString()} ${count === 1 ? "company" : "companies"}`
const NAME_COLUMN = "w-[34%]"
const COUNT_COLUMN = "w-32"

function LoadingRows() {
  const widths = [56, 72, 48, 64, 80, 52, 68, 60, 44, 76, 58, 66]
  return (
    <TableScroll aria-busy="true">
      <span className="sr-only" role="status">
        Loading companies
      </span>
      <Table aria-hidden="true">
        <tbody>
          {widths.map((width) => (
            <Tr key={width}>
              <Td className={cn(checkCellClass, TALL)} />
              <Td className={cn(NAME_COLUMN, TALL)}>
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-7 shrink-0 rounded-md" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div style={{ width: `${width * 0.7}%` }}>
                      <Skeleton />
                    </div>
                    <div style={{ width: `${width * 0.4}%` }}>
                      <Skeleton />
                    </div>
                  </div>
                </div>
              </Td>
              <Td className={cn(COUNT_COLUMN, TALL)}>
                <Skeleton className="w-6" />
              </Td>
              <Td className={cn(wideColumnClass, TALL)} />
              <Td className={cn(dateColumnClass, wideColumnClass, TALL)}>
                <Skeleton className="w-8" />
              </Td>
              <Td className={cn(dateColumnClass, wideColumnClass, TALL)}>
                <Skeleton className="w-8" />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  )
}

function DeletedCompanies(props: { readonly teamId: TeamId; readonly onRestore: (id: string) => Promise<void> }) {
  const deleted = useQuery({
    queryKey: ["companies-deleted", props.teamId],
    queryFn: () => call("companies.list", { teamId: props.teamId, deleted: true, limit: 200 }),
  })
  if (deleted.isLoading) return <LoadingRows />
  if (deleted.isError) {
    return (
      <LoadFailed
        title="Deleted companies didn't load"
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
          Companies you delete stay here for 30 days, with their contacts' affiliations, so you can restore them.
        </EmptyState>
      </Centered>
    )
  }
  return (
    <TableScroll>
      <Table>
        <caption className="sr-only">Deleted companies</caption>
        <thead>
          <tr>
            <Th className={cn(NAME_COLUMN, "pl-4")} scope="col">
              Name
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
          {items.map((company) => (
            <Tr key={company.id}>
              <Td className={cn(TALL, "pl-4")}>
                <span className="flex min-w-0 items-center gap-2.5 font-medium">
                  <CompanyLogo company={company} size="md" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{company.name}</span>
                    {primaryDomainOf(company) ? (
                      <span className="truncate text-sm font-normal text-subtle">{primaryDomainOf(company)}</span>
                    ) : null}
                  </span>
                </span>
              </Td>
              <Td
                className={cn(TALL, wideColumnClass, dateCellClass)}
                title={company.deletedAt ? absolute(company.deletedAt) : undefined}
              >
                {company.deletedAt ? relative(company.deletedAt) : ""}
              </Td>
              <Td className={cn(TALL, "text-right")}>
                <Button size="sm" onClick={() => void props.onRestore(company.id)}>
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

/** A property's value in the create panel, and a problem with it. */
const VALUE = "flex min-w-0 flex-col px-1.5"
const ERROR = "my-1 text-sm text-danger"

interface DomainProblem {
  readonly message: UserText
  readonly existing?: string
}

function CreatePanel(props: {
  readonly teamId: TeamId
  readonly teamName: string
  readonly onClose: () => void
  readonly onCreated: (company: Company) => Promise<void>
  readonly onOpenExisting: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [domains, setDomains] = useState<ReadonlyArray<string>>([""])
  const [problems, setProblems] = useState<ReadonlyArray<FieldProblem>>()
  const [domainProblem, setDomainProblem] = useState<DomainProblem>()
  const [error, setError] = useState<UserText>()
  const formRef = useRef<HTMLFormElement>(null)
  // A company made here is its creator's unless they choose someone else (D123).
  const { userId } = teamRoute.useRouteContext()
  const [ownerId, setOwnerId] = useState<UserId | null>(userId as UserId)
  const people = usePeople(props.teamId).data ?? []
  const ownerName = people.find((person) => person.userId === ownerId)?.name ?? null

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const form = new FormData(formRef.current ?? undefined)
    const text = (field: string) => String(form.get(field) ?? "").trim()
    const listed = domains.map((domain) => domain.trim()).filter(Boolean)
    const website = text("website")
    const phone = toE164(text("phone"))
    const address = addressFrom(text)
    setProblems(undefined)
    setDomainProblem(undefined)
    setError(undefined)
    setBusy(true)
    try {
      const company = await call("companies.create", {
        teamId: props.teamId,
        name: name.trim(),
        ...(listed.length > 0 ? { domains: listed.map((domain) => ({ domain: domain as Domain })) } : {}),
        ...(website ? { website: toWebsite(website) as Company["website"] } : {}),
        ...(phone ? { phone: phone as Company["phone"] } : {}),
        ...(address ? { address } : {}),
        ownerId,
      })
      await props.onCreated(company)
    } catch (failure) {
      setBusy(false)
      const fieldProblems = problemsOf(failure)
      if (fieldProblems) return setProblems(fieldProblems)
      if (isApiFailure(failure) && failure.error._tag === "CompanyDomainTaken") {
        const existing = (failure.error.details as { existing?: string } | undefined)?.existing
        return setDomainProblem({ message: failure.error.userMessage, ...(existing ? { existing } : {}) })
      }
      if (isApiFailure(failure) && failure.error._tag === "FreeEmailDomain") {
        return setDomainProblem({ message: failure.error.userMessage })
      }
      setError(messageOf(failure))
    }
  }

  const fieldError = (field: string) => problemFor(problems, field)
  const domainError =
    domainProblem?.message ?? problems?.find((problem) => problem.field.startsWith("domains"))?.userMessage
  // Caught before asking the server, so the person sees it while typing (D106).
  const freeDomain = domains.find((domain) => domain.trim() && isFreeEmailDomain(domain))
  const shownDomainError =
    domainError ??
    (freeDomain
      ? `${normalizeDomain(freeDomain)} is a free email domain, so it can't belong to a company. Anyone can have an address there.`
      : undefined)

  return (
    <RecordPanel aria-label="New company">
      <PanelHeader>
        <div className="flex items-center">
          <span className="text-sm text-subtle">New company</span>
          <Spacer />
          <IconButton label="Close panel" tip="Close  Esc" onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <div className="flex items-center gap-3">
          <Avatar size="lg" shape="square">
            {name.trim() ? initialsOfName(name) : ""}
          </Avatar>
          <div className="min-w-0">
            <RecordTitle className={cn(!name.trim() && "text-subtle")}>{name.trim() || "Untitled company"}</RecordTitle>
            <p className="m-0 text-sm text-muted">Only a name is needed.</p>
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
          <PropertyRow label="Name" htmlFor="nco-name">
            <div className={VALUE}>
              <InlineInput
                id="nco-name"
                type="text"
                autoComplete="off"
                placeholder="Empty"
                maxLength={200}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={fieldError("name") ? true : undefined}
              />
              {fieldError("name") ? <p className={ERROR}>{fieldError("name")}</p> : null}
            </div>
          </PropertyRow>
          <PropertyRow label="Domains" htmlFor="nco-domain-0">
            <div className={VALUE}>
              {domains.map((domain, index) => (
                <InlineInput
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while typing
                  key={index}
                  id={`nco-domain-${index}`}
                  type="text"
                  autoComplete="off"
                  placeholder={index === 0 ? "acme.com" : "Another domain"}
                  value={domain}
                  aria-invalid={shownDomainError ? true : undefined}
                  aria-describedby="nco-domain-msg"
                  onChange={(event) => {
                    const next = [...domains]
                    next[index] = event.target.value
                    setDomains(next)
                    setDomainProblem(undefined)
                  }}
                />
              ))}
              {shownDomainError ? (
                <p id="nco-domain-msg" className={ERROR}>
                  {shownDomainError}{" "}
                  {domainProblem?.existing ? (
                    <TextButton className="text-sm" onClick={() => props.onOpenExisting(domainProblem.existing ?? "")}>
                      Open company
                    </TextButton>
                  ) : null}
                </p>
              ) : (
                <Hint className="my-1">
                  <span id="nco-domain-msg">
                    Contacts with an email at these domains are affiliated with this company (domain matching).
                  </span>
                </Hint>
              )}
              <TextButton className="mt-0.5 mb-1 text-sm" onClick={() => setDomains([...domains, ""])}>
                <PlusIcon className="size-3.5" />
                Add domain
              </TextButton>
            </div>
          </PropertyRow>
          {[
            { field: "website", label: "Website", type: "url" },
            { field: "phone", label: "Phone", type: "tel" },
          ].map((entry) => (
            <PropertyRow key={entry.field} label={entry.label} htmlFor={`nco-${entry.field}`}>
              <div className={VALUE}>
                <InlineInput
                  id={`nco-${entry.field}`}
                  name={entry.field}
                  type={entry.type}
                  autoComplete="off"
                  placeholder="Empty"
                  aria-invalid={fieldError(entry.field) ? true : undefined}
                />
                {fieldError(entry.field) ? <p className={ERROR}>{fieldError(entry.field)}</p> : null}
              </div>
            </PropertyRow>
          ))}
          <RecordOwnerField
            teamId={props.teamId}
            label="Company owner"
            ownerId={ownerId}
            ownerName={ownerName}
            onChange={(owner) => setOwnerId(owner?.id ?? null)}
          />
        </Section>
        <Section>
          <SectionHeader className="text-sm">Address</SectionHeader>
          <AddressInputs idPrefix="nco" value={null} />
          {problems?.some((problem) => problem.field.startsWith("address")) ? (
            <p className={ERROR}>{problems.find((problem) => problem.field.startsWith("address"))?.userMessage}</p>
          ) : null}
          {error ? (
            <p className={ERROR} role="alert">
              {error}
            </p>
          ) : null}
        </Section>
        <ButtonBase variant={null} size="none" type="submit" className="sr-only" tabIndex={-1}>
          Create company
        </ButtonBase>
      </form>
      <PanelFooter>
        <Button
          variant="primary"
          disabled={busy || name.trim() === "" || freeDomain !== undefined}
          onClick={() => void submit()}
        >
          Create company <Kbd onPrimary>⌘↵</Kbd>
        </Button>
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
      </PanelFooter>
    </RecordPanel>
  )
}
