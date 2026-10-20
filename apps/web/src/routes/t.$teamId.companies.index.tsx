import {
  type Company,
  type CompanyId,
  companyFieldReader,
  type FieldProblem,
  filterFields,
  isFreeEmailDomain,
  matchesFilter,
  normalizeDomain,
  ROLE_PERMISSIONS,
  type TeamId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useLiveQuery } from "@tanstack/react-db"
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
import { CloseIcon, CompaniesIcon, PlusIcon, RestoreIcon, TrashIcon } from "../components/icons.tsx"
import { CompanyLogo } from "../components/images.tsx"
import { DisplayMenu, ImportDialog, SaveViewDialog, SetFieldDialog, ViewActions } from "../components/index-view.tsx"
import { initialsOfName, LoadFailed, problemFor, problemsOf, toE164, toggle } from "../components/record.tsx"
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
import { companiesCollection, primaryDomainOf } from "../lib/companies.ts"
import { useFields } from "../lib/custom-fields.ts"
import { compareBy, download, useIndexView } from "../lib/index-view.ts"
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

/** The shape TanStack DB hands to an update: the company, writable. */
function CompaniesScreen() {
  const { team } = useShell()
  const teamId = team.id as TeamId
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const collection = companiesCollection(teamId, queryClient)
  const live = useLiveQuery((q) => q.from({ company: collection }), [collection])
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursor, setCursor] = useState<string>()
  const [toast, setToast] = useState<ToastRequest>()
  const [dialog, setDialog] = useState<"save-view" | "import" | "set-field" | "affiliate">()
  const { fields } = useFields(teamId, "company")
  const indexView = useIndexView(teamId, "company", search.view)
  const filterInfo = useMemo(() => filterFields("company", fields), [fields])
  const shownFields = fields.filter(
    (field) => indexView.state.columns.includes(`custom:${field.id}`) || indexView.state.columns.includes(field.id),
  )
  const { userId } = teamRoute.useRouteContext()
  const canWrite = ROLE_PERMISSIONS[team.role].has("records:write")

  /** Exports what's showing (D62): the view's filter, or just the selection. */
  const exportCsv = async (ids: ReadonlyArray<string> | undefined) => {
    try {
      const result = await call("companies.export", {
        teamId,
        ...(ids ? { ids: [...ids] } : { filter: indexView.state.filter }),
      })
      download(`companies-${new Date().toISOString().slice(0, 10)}.csv`, result.csv)
      showToast({ text: `Exported ${result.count} ${result.count === 1 ? "company" : "companies"}.` })
    } catch (failure) {
      showToast({ text: messageOf(failure) })
    }
  }
  const filterRef = useRef<HTMLInputElement>(null)

  const companies = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...(live.data ?? [])]
      .filter(
        (company) =>
          !q || company.name.toLowerCase().includes(q) || company.domains.some((entry) => entry.domain.includes(q)),
      )
      .filter((record) => matchesFilter(indexView.state.filter, companyFieldReader(record)))
      .sort(
        indexView.state.sort
          ? compareBy(companyFieldReader, indexView.state.sort)
          : (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      )
  }, [live.data, filter, indexView.state])

  const open = search.company ? companies.find((company) => company.id === search.company) : undefined
  const setSearch = useCallback(
    (next: Search) => navigate({ search: { ...(search.view ? { view: search.view } : {}), ...next } }),
    [navigate, search.view],
  )

  const showToast = useCallback((next: ToastRequest) => {
    setToast(next)
    window.setTimeout(() => setToast((current) => (current === next ? undefined : current)), 8000)
  }, [])

  const restore = useCallback(
    async (ids: ReadonlyArray<string>) => {
      try {
        for (const id of ids) await call("companies.restore", { teamId, companyId: id as CompanyId })
      } catch (failure) {
        showToast({ text: messageOf(failure) })
      }
      await collection.utils.refetch()
      await queryClient.invalidateQueries({ queryKey: ["companies-deleted", teamId] })
    },
    [collection, queryClient, showToast, teamId],
  )

  const remove = useCallback(
    (ids: ReadonlyArray<string>) => {
      if (ids.length === 0) return
      const transaction = collection.delete(ids.map((id) => id as CompanyId))
      setSelected(new Set())
      if (search.company && ids.includes(search.company)) void setSearch({})
      const text = ids.length === 1 ? "1 company deleted" : `${ids.length} companies deleted`
      showToast({ text, undo: () => void restore(ids) })
      transaction.isPersisted.promise.catch((failure: unknown) => showToast({ text: messageOf(failure) }))
    },
    [collection, restore, search.company, setSearch, showToast],
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
      const index = companies.findIndex((company) => company.id === (open?.id ?? cursor))
      const move = (delta: number) => {
        const next = companies[Math.min(Math.max(index + delta, 0), companies.length - 1)]
        if (!next) return
        if (open) void setSearch({ company: next.id })
        else setCursor(next.id)
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault()
        move(index < 0 ? 0 : 1)
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault()
        move(index < 0 ? 0 : -1)
      } else if (event.key === "Enter" && cursor && !open) {
        void setSearch({ company: cursor })
      } else if (event.key === "x" && cursor) {
        setSelected((current) => toggle(current, cursor))
      } else if ((event.key === "Backspace" || event.key === "Delete") && selected.size > 0) {
        event.preventDefault()
        remove([...selected])
      } else if (event.key === "/") {
        event.preventDefault()
        filterRef.current?.focus()
      } else if (event.key === "Escape") {
        if (search.company || search.new) void setSearch({})
        else if (selected.size > 0) setSelected(new Set())
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [companies, cursor, open, remove, search, selected, setSearch, toast])

  const allChecked = companies.length > 0 && companies.every((company) => selected.has(company.id))
  const someChecked = !allChecked && companies.some((company) => selected.has(company.id))
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
                  Companies
                </button>
                <BreadcrumbSeparator />
                <span>Deleted</span>
              </>
            ) : (
              <span>{indexView.view?.name ?? "Companies"}</span>
            )}
          </Breadcrumb>
          {!search.deleted && !isLoading && !isEmpty ? <Count>{companies.length}</Count> : null}
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
              <FilterBar fields={filterInfo} filter={indexView.state.filter} onChange={indexView.setFilter} />
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
              showingDeleted={search.deleted === true}
              onToggleDeleted={() => void setSearch(search.deleted ? {} : { deleted: true })}
              onExport={() => void exportCsv(undefined)}
              onImport={() => setDialog("import")}
            />
          </Toolbar>
        )}

        <ViewBody>
          {search.deleted ? (
            <DeletedCompanies teamId={teamId} onRestore={restore} />
          ) : isLoading ? (
            <LoadingRows />
          ) : loadError ? (
            <LoadFailed
              title="Companies didn't load"
              message={messageOf(loadError)}
              onRetry={() => void collection.utils.refetch()}
            />
          ) : isEmpty ? (
            <Centered>
              <EmptyState
                icon={<CompaniesIcon />}
                title="No companies yet"
                actions={
                  <Button variant="primary" onClick={() => void setSearch({ new: true })}>
                    New company <Kbd onPrimary>C</Kbd>
                  </Button>
                }
              >
                Companies are the organizations your contacts work for. Give a company its domains, and contacts with an
                email there are affiliated with it on their own.
              </EmptyState>
            </Centered>
          ) : companies.length === 0 ? (
            <Centered>
              <EmptyState title={`No companies match “${filter}”`}>Try part of a name or a domain.</EmptyState>
            </Centered>
          ) : (
            <TableScroll padForBar={selected.size > 0}>
              <Table>
                <caption className="sr-only">Companies</caption>
                <thead>
                  <tr>
                    <Th className={checkCellClass} scope="col">
                      <Checkbox
                        reveal={selected.size === 0}
                        mixed={someChecked}
                        aria-label="Select all companies"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(companies.map((c) => c.id)))}
                      />
                    </Th>
                    <Th className={NAME_COLUMN} scope="col">
                      Name
                    </Th>
                    <Th className={COUNT_COLUMN} scope="col">
                      Contacts
                    </Th>
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
                  {companies.map((company) => {
                    const domain = primaryDomainOf(company)
                    return (
                      <Tr
                        key={company.id}
                        checked={selected.has(company.id)}
                        open={open?.id === company.id}
                        cursor={!open && cursor === company.id}
                      >
                        <Td className={cn(checkCellClass, TALL)}>
                          <Checkbox
                            reveal={selected.size === 0}
                            aria-label={`Select ${company.name}`}
                            checked={selected.has(company.id)}
                            onChange={() => setSelected((current) => toggle(current, company.id))}
                          />
                        </Td>
                        <Td className={TALL}>
                          <button
                            className={nameButtonClass}
                            type="button"
                            onClick={() => void setSearch({ company: company.id })}
                          >
                            <CompanyLogo company={company} size="md" />
                            <span className="flex min-w-0 flex-col">
                              <span className={nameTextClass}>{company.name}</span>
                              {domain ? (
                                <span className="truncate text-sm font-normal text-subtle">{domain}</span>
                              ) : null}
                            </span>
                          </button>
                        </Td>
                        <Td className={cn(TALL, "tabular-nums", company.contactCount === 0 && "text-subtle")}>
                          {contactsLabel(company.contactCount)}
                        </Td>
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
            <Button variant="ghost" size="sm" onClick={() => void exportCsv([...selected])}>
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
          recordType="company"
          plural="companies"
          customFields={fields}
          onClose={() => setDialog(undefined)}
          onImport={async (csv, mapping) => {
            const result = await call("companies.import", { teamId, csv, mapping })
            await collection.utils.refetch()
            return result
          }}
        />
      ) : dialog === "set-field" ? (
        <SetFieldDialog
          count={selected.size}
          noun={selected.size === 1 ? "company" : "companies"}
          fields={fields}
          onClose={() => setDialog(undefined)}
          onApply={async (field, value) => {
            const ids = [...selected]
            const transaction = collection.update(
              ids.map((id) => id as CompanyId),
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
            showToast({ text: `${field.name} is set on ${ids.length} ${ids.length === 1 ? "company" : "companies"}.` })
            transaction.isPersisted.promise.catch((failure: unknown) => showToast({ text: messageOf(failure) }))
          }}
        />
      ) : null}
      {search.new ? (
        <CreatePanel
          teamId={teamId}
          teamName={team.name}
          onClose={() => void setSearch({})}
          onCreated={async (company) => {
            await collection.utils.refetch()
            void setSearch({ company: company.id })
          }}
          onOpenExisting={(id) => void setSearch({ company: id })}
        />
      ) : open ? (
        <CompanyPanel
          key={open.id}
          company={open}
          teamId={teamId}
          position={{ index: companies.indexOf(open), total: companies.length }}
          onMove={(delta) => {
            const next = companies[companies.indexOf(open) + delta]
            if (next) void setSearch({ company: next.id })
          }}
          onClose={() => void setSearch({})}
          onDelete={() => remove([open.id])}
          onToast={showToast}
          collection={collection}
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

function DeletedCompanies(props: {
  readonly teamId: TeamId
  readonly onRestore: (ids: ReadonlyArray<string>) => Promise<void>
}) {
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
                <Button size="sm" onClick={() => void props.onRestore([company.id])}>
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
        <button type="submit" className="sr-only" tabIndex={-1}>
          Create company
        </button>
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
