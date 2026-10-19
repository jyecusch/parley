import {
  type Company,
  type CompanyId,
  type FieldProblem,
  isFreeEmailDomain,
  normalizeDomain,
  type PostalAddress,
  type TeamId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useLiveQuery } from "@tanstack/react-db"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CompanyContacts, type ToastRequest } from "../components/affiliations.tsx"
import {
  ChevronDown,
  ChevronUp,
  CloseIcon,
  CompaniesIcon,
  DisplayIcon,
  MoreIcon,
  PlusIcon,
  RestoreIcon,
  TrashIcon,
} from "../components/icons.tsx"
import {
  ActivityRow,
  EditableList,
  EditableText,
  initialsOfName,
  LoadFailed,
  problemFor,
  problemsOf,
  toE164,
  toggle,
} from "../components/record.tsx"
import { isTyping, useShell } from "../components/shell.tsx"
import { call, isApiFailure, messageOf } from "../lib/client.ts"
import { companiesCollection, primaryDomainOf } from "../lib/companies.ts"
import { COUNTRIES, countryName } from "../lib/countries.ts"
import { absolute, relative } from "../lib/time.ts"

export interface Search {
  readonly company?: string
  readonly new?: boolean
  readonly deleted?: boolean
}

export const Route = createFileRoute("/t/$teamId/companies")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.company === "string" ? { company: search.company } : {}),
    ...(search.new === true || search.new === "true" ? { new: true } : {}),
    ...(search.deleted === true || search.deleted === "true" ? { deleted: true } : {}),
  }),
  component: CompaniesScreen,
})

/** The shape TanStack DB hands to an update: the company, writable. */
type Draft = { -readonly [K in keyof Company]: Company[K] }
type Domain = Company["domains"][number]["domain"]

/** What people type into a website field, as a URL: "acme.com" → "https://acme.com". */
const toWebsite = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`)

const contactsLabel = (count: number) => (count === 0 ? "None" : String(count))

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
  const [displayMenu, setDisplayMenu] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)

  const companies = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return [...(live.data ?? [])]
      .filter(
        (company) =>
          !q || company.name.toLowerCase().includes(q) || company.domains.some((entry) => entry.domain.includes(q)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
  }, [live.data, filter])

  const open = search.company ? companies.find((company) => company.id === search.company) : undefined
  const setSearch = useCallback((next: Search) => navigate({ search: next }), [navigate])

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
      <main className={`card main ${selected.size > 0 ? "has-sel" : ""}`}>
        <div className="hd1">
          <h1 className="crumb">
            {search.deleted ? (
              <>
                <button className="root linkish" type="button" onClick={() => void setSearch({})}>
                  Companies
                </button>
                <span className="sep" aria-hidden="true">
                  /
                </span>
                <span>Deleted</span>
              </>
            ) : (
              <span>Companies</span>
            )}
          </h1>
          {!search.deleted && !isLoading && !isEmpty ? <span className="count">{companies.length}</span> : null}
          <div className="spacer" />
          {isEmpty && !search.deleted ? null : (
            <button className="btn primary" type="button" onClick={() => void setSearch({ new: true })}>
              New company <span className="kbd on-primary">C</span>
            </button>
          )}
        </div>

        {isEmpty && !search.deleted ? null : (
          <div className="hd2">
            {search.deleted ? (
              <span className="sm-t" style={{ color: "var(--fg-subtle)", marginLeft: 7 }}>
                Deleted companies can be restored for 30 days.
              </span>
            ) : (
              <>
                <label className="vh" htmlFor="company-filter">
                  Filter companies
                </label>
                <input
                  ref={filterRef}
                  id="company-filter"
                  className="search-inp"
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
            <div className="spacer" />
            <div style={{ position: "relative" }}>
              <button className="btn ghost sm trail-btn" type="button" onClick={() => setDisplayMenu((v) => !v)}>
                <DisplayIcon />
                Display
              </button>
              {displayMenu ? (
                <div className="menu" style={{ right: 0, top: 30 }}>
                  <button
                    className="menu-i"
                    type="button"
                    onClick={() => {
                      setDisplayMenu(false)
                      void setSearch(search.deleted ? {} : { deleted: true })
                    }}
                  >
                    Show deleted companies
                    {search.deleted ? <span className="hint">✓</span> : null}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="body">
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
            <div className="center">
              <div className="empty">
                <div className="e-ic">
                  <CompaniesIcon />
                </div>
                <h2>No companies yet</h2>
                <p>
                  Companies are the organizations your contacts work for. Give a company its domains, and contacts with
                  an email there are affiliated with it on their own.
                </p>
                <div className="actions">
                  <button className="btn primary" type="button" onClick={() => void setSearch({ new: true })}>
                    New company <span className="kbd on-primary">C</span>
                  </button>
                </div>
              </div>
            </div>
          ) : companies.length === 0 ? (
            <div className="center">
              <div className="empty">
                <h2>No companies match “{filter}”</h2>
                <p>Try part of a name or a domain.</p>
              </div>
            </div>
          ) : (
            <div className="tablewrap">
              <table className="ctable">
                <caption className="vh">Companies</caption>
                <thead>
                  <tr>
                    <th className="w-check c-check" scope="col">
                      <input
                        className={`cb ${someChecked ? "is-mixed" : ""}`}
                        type="checkbox"
                        aria-label="Select all companies"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(companies.map((c) => c.id)))}
                      />
                    </th>
                    <th className="w-co-name" scope="col">
                      Name
                    </th>
                    <th className="w-count" scope="col">
                      Contacts
                    </th>
                    <th className="col-wide" scope="col">
                      <span className="vh">Spacer</span>
                    </th>
                    <th className="w-date col-wide" scope="col">
                      Created
                    </th>
                    <th className="w-date col-wide" scope="col">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => {
                    const domain = primaryDomainOf(company)
                    const className = [
                      selected.has(company.id) ? "is-checked" : "",
                      open?.id === company.id ? "is-open" : "",
                      !open && cursor === company.id ? "is-cursor" : "",
                    ]
                      .join(" ")
                      .trim()
                    return (
                      <tr key={company.id} className={className}>
                        <td className="c-check tall">
                          <input
                            className="cb"
                            type="checkbox"
                            aria-label={`Select ${company.name}`}
                            checked={selected.has(company.id)}
                            onChange={() => setSelected((current) => toggle(current, company.id))}
                          />
                        </td>
                        <td className="tall">
                          <button
                            className="namebtn"
                            type="button"
                            onClick={() => void setSearch({ company: company.id })}
                          >
                            <span className="tile md" aria-hidden="true">
                              {initialsOfName(company.name)}
                            </span>
                            <span className="stack">
                              <span className="n">{company.name}</span>
                              {domain ? <span className="s sm-t">{domain}</span> : null}
                            </span>
                          </button>
                        </td>
                        <td className={`tall tab ${company.contactCount === 0 ? "c-none" : ""}`}>
                          {contactsLabel(company.contactCount)}
                        </td>
                        <td className="tall col-wide" />
                        <td className="tall col-wide c-date" title={`Created ${absolute(company.createdAt)}`}>
                          {relative(company.createdAt)}
                        </td>
                        <td className="tall col-wide c-date" title={`Updated ${absolute(company.updatedAt)}`}>
                          {relative(company.updatedAt)}
                        </td>
                      </tr>
                    )
                  })}
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
        />
      ) : null}
    </>
  )
}

function LoadingRows() {
  const widths = [56, 72, 48, 64, 80, 52, 68, 60, 44, 76, 58, 66]
  return (
    <div className="tablewrap" aria-busy="true">
      <span className="vh" role="status">
        Loading companies
      </span>
      <table className="ctable" aria-hidden="true">
        <tbody>
          {widths.map((width) => (
            <tr key={width}>
              <td className="c-check w-check tall" />
              <td className="w-co-name tall">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="sk" style={{ width: 24, height: 24, borderRadius: 6, flex: "none" }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="sk" style={{ width: `${width * 0.7}%` }} />
                    <div className="sk" style={{ width: `${width * 0.4}%` }} />
                  </div>
                </div>
              </td>
              <td className="w-count tall">
                <div className="sk" style={{ width: 20 }} />
              </td>
              <td className="col-wide tall" />
              <td className="col-wide w-date tall">
                <div className="sk" style={{ width: 28 }} />
              </td>
              <td className="col-wide w-date tall">
                <div className="sk" style={{ width: 28 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <div className="center">
        <div className="empty">
          <div className="e-ic">
            <TrashIcon />
          </div>
          <h2>Nothing deleted</h2>
          <p>Companies you delete stay here for 30 days, with their contacts' affiliations, so you can restore them.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="tablewrap">
      <table className="ctable">
        <caption className="vh">Deleted companies</caption>
        <thead>
          <tr>
            <th className="w-co-name" scope="col" style={{ paddingLeft: 14 }}>
              Name
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
          {items.map((company) => (
            <tr key={company.id}>
              <td style={{ paddingLeft: 14 }}>
                <span className="namebtn" style={{ cursor: "default" }}>
                  <span className="tile md" aria-hidden="true">
                    {initialsOfName(company.name)}
                  </span>
                  <span className="stack">
                    <span className="n">{company.name}</span>
                    {primaryDomainOf(company) ? <span className="s sm-t">{primaryDomainOf(company)}</span> : null}
                  </span>
                </span>
              </td>
              <td className="col-wide c-date" title={company.deletedAt ? absolute(company.deletedAt) : undefined}>
                {company.deletedAt ? relative(company.deletedAt) : ""}
              </td>
              <td style={{ textAlign: "right" }}>
                <button className="btn sm" type="button" onClick={() => void props.onRestore([company.id])}>
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

const ADDRESS_FIELDS = [
  { key: "line1", label: "Street", full: true },
  { key: "line2", label: "Street, line 2", full: true },
  { key: "city", label: "City", full: false },
  { key: "region", label: "Region", full: false },
  { key: "postcode", label: "Postcode", full: false },
] as const

/** The address from a form, or null when every part is empty. */
const addressFrom = (read: (name: string) => string): PostalAddress | null => {
  const address: PostalAddress = {
    line1: read("line1") || null,
    line2: read("line2") || null,
    city: read("city") || null,
    region: read("region") || null,
    postcode: read("postcode") || null,
    country: read("country") || null,
  }
  return Object.values(address).some(Boolean) ? address : null
}

function AddressInputs(props: { readonly idPrefix: string; readonly value: PostalAddress | null }) {
  return (
    <div className="addr-grid">
      {ADDRESS_FIELDS.map((field) => (
        <div key={field.key} className={field.full ? "full" : undefined}>
          <label className="sub" htmlFor={`${props.idPrefix}-${field.key}`}>
            {field.label}
          </label>
          <input
            id={`${props.idPrefix}-${field.key}`}
            name={field.key}
            className="finp"
            type="text"
            autoComplete="off"
            placeholder="Empty"
            maxLength={field.key === "postcode" ? 20 : 200}
            defaultValue={props.value?.[field.key] ?? ""}
          />
        </div>
      ))}
      <div>
        <label className="sub" htmlFor={`${props.idPrefix}-country`}>
          Country
        </label>
        <select
          id={`${props.idPrefix}-country`}
          name="country"
          className="fsel"
          defaultValue={props.value?.country ?? ""}
        >
          <option value="">Choose…</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/** A domain problem in our words, with a way to the company that has it. */
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
    <aside className="card panel" aria-label="New company">
      <div className="ph">
        <div className="ph-bar">
          <span className="pos sm-t" style={{ marginLeft: 6 }}>
            New company
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
          <span className="tile lg" aria-hidden="true">
            {name.trim() ? initialsOfName(name) : ""}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="pname" style={name.trim() ? undefined : { color: "var(--fg-subtle)" }}>
              {name.trim() || "Untitled company"}
            </h2>
            <p className="paff sm-t">Only a name is needed.</p>
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
          <div className="field">
            <label className="flabel sm-t" htmlFor="nco-name">
              Name
            </label>
            <div className="fval" style={{ padding: "0 6px" }}>
              <input
                id="nco-name"
                className="finp"
                type="text"
                autoComplete="off"
                placeholder="Empty"
                maxLength={200}
                // biome-ignore lint/a11y/noAutofocus: the create panel opens for typing, like a dialog
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={fieldError("name") ? true : undefined}
              />
              {fieldError("name") ? <p className="ferr sm-t">{fieldError("name")}</p> : null}
            </div>
          </div>
          <div className="field">
            <label className="flabel sm-t" htmlFor="nco-domain-0">
              Domains
            </label>
            <div className="fval" style={{ padding: "0 6px" }}>
              {domains.map((domain, index) => (
                <input
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while typing
                  key={index}
                  id={`nco-domain-${index}`}
                  className="finp"
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
                <p id="nco-domain-msg" className="ferr sm-t">
                  {shownDomainError}{" "}
                  {domainProblem?.existing ? (
                    <button
                      className="linkish sm-t"
                      type="button"
                      onClick={() => props.onOpenExisting(domainProblem.existing ?? "")}
                    >
                      Open company
                    </button>
                  ) : null}
                </p>
              ) : (
                <p id="nco-domain-msg" className="fhint sm-t">
                  Contacts with an email at these domains are affiliated with this company (domain matching).
                </p>
              )}
              <button
                className="linkish sm-t"
                type="button"
                style={{ margin: "2px 0 4px" }}
                onClick={() => setDomains([...domains, ""])}
              >
                <PlusIcon size={12} />
                Add domain
              </button>
            </div>
          </div>
          {[
            { field: "website", label: "Website", type: "url" },
            { field: "phone", label: "Phone", type: "tel" },
          ].map((entry) => (
            <div className="field" key={entry.field}>
              <label className="flabel sm-t" htmlFor={`nco-${entry.field}`}>
                {entry.label}
              </label>
              <div className="fval" style={{ padding: "0 6px" }}>
                <input
                  id={`nco-${entry.field}`}
                  name={entry.field}
                  className="finp"
                  type={entry.type}
                  autoComplete="off"
                  placeholder="Empty"
                  aria-invalid={fieldError(entry.field) ? true : undefined}
                />
                {fieldError(entry.field) ? <p className="ferr sm-t">{fieldError(entry.field)}</p> : null}
              </div>
            </div>
          ))}
        </section>
        <section className="sec">
          <h3 className="sec-h sm-t">Address</h3>
          <AddressInputs idPrefix="nco" value={null} />
          {problems?.some((problem) => problem.field.startsWith("address")) ? (
            <p className="ferr sm-t">{problems.find((problem) => problem.field.startsWith("address"))?.userMessage}</p>
          ) : null}
          {error ? (
            <p className="ferr sm-t" role="alert">
              {error}
            </p>
          ) : null}
        </section>
        <button type="submit" className="vh" tabIndex={-1}>
          Create company
        </button>
      </form>
      <div className="pfoot">
        <button
          className="btn primary"
          type="button"
          disabled={busy || name.trim() === "" || freeDomain !== undefined}
          onClick={() => void submit()}
        >
          Create company <span className="kbd on-primary">⌘↵</span>
        </button>
        <button className="btn ghost" type="button" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </aside>
  )
}

function CompanyPanel(props: {
  readonly company: Company
  readonly teamId: TeamId
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onToast: (toast: ToastRequest) => void
  readonly collection: ReturnType<typeof companiesCollection>
}) {
  const { company, collection } = props
  const queryClient = useQueryClient()
  const [moreMenu, setMoreMenu] = useState(false)
  const activity = useQuery({
    queryKey: ["company-activity", props.teamId, company.id, company.updatedAt, company.contactCount],
    queryFn: () => call("companies.activity", { teamId: props.teamId, companyId: company.id }),
  })
  const domain = primaryDomainOf(company)

  const save = (change: (draft: Draft) => void) => {
    const transaction = collection.update(company.id, (draft) => change(draft as Draft))
    transaction.isPersisted.promise
      .then(async () => {
        // Adding a domain can affiliate contacts (D105), so contacts and counts are refreshed.
        await collection.utils.refetch()
        await queryClient.invalidateQueries({ queryKey: ["company-activity", props.teamId, company.id] })
        await queryClient.invalidateQueries({ queryKey: ["affiliations", props.teamId, company.id] })
        await queryClient.invalidateQueries({ queryKey: ["contacts", props.teamId] })
      })
      .catch((failure: unknown) => props.onToast({ text: messageOf(failure) }))
  }

  return (
    <aside className="card panel" aria-label={`Company ${company.name}`}>
      <div className="ph">
        <div className="ph-bar">
          <button
            className="ibtn tip tip-b"
            type="button"
            aria-label="Previous company"
            data-tip="Previous  K"
            onClick={() => props.onMove(-1)}
          >
            <ChevronUp />
          </button>
          <button
            className="ibtn tip tip-b"
            type="button"
            aria-label="Next company"
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
                <button className="menu-i" type="button" style={{ color: "var(--danger)" }} onClick={props.onDelete}>
                  <TrashIcon size={14} />
                  Delete company
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
          <span className="tile lg" aria-hidden="true">
            {initialsOfName(company.name)}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="pname">{company.name}</h2>
            <p className="paff sm-t">
              {[domain, `${company.contactCount} ${company.contactCount === 1 ? "contact" : "contacts"}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </div>
      <div className="pbody">
        <section className="sec">
          <EditableText
            label="Name"
            value={company.name}
            onSave={(value) => {
              // A company always has a name; clearing it keeps the old one.
              if (value)
                save((draft) => {
                  draft.name = value
                })
            }}
          />
          <EditableList
            label="Domains"
            empty="Add domain"
            items={company.domains.map((entry) => ({
              value: entry.domain,
              tag: entry.isPrimary && company.domains.length > 1 ? "Primary" : undefined,
            }))}
            type="text"
            onSave={(values) =>
              save((draft) => {
                draft.domains = values.map((value, index) => ({
                  domain: normalizeDomain(value) as Domain,
                  isPrimary: index === 0,
                }))
              })
            }
          />
          <EditableText
            label="Website"
            value={company.website}
            onSave={(value) =>
              save((draft) => {
                draft.website = (value ? toWebsite(value) : null) as Company["website"]
              })
            }
          />
          <EditableText
            label="Phone"
            value={company.phone}
            onSave={(value) =>
              save((draft) => {
                draft.phone = (value ? toE164(value) : null) as Company["phone"]
              })
            }
          />
          <EditableAddress
            value={company.address}
            onSave={(address) =>
              save((draft) => {
                draft.address = address
              })
            }
          />
        </section>
        <CompanyContacts company={company} teamId={props.teamId} onToast={props.onToast} />
        <section className="sec">
          <h3 className="sec-h sm-t">Activity</h3>
          {activity.isLoading ? <div className="sk" style={{ width: "60%", margin: "8px 0" }} /> : null}
          {activity.isError ? <p className="ferr sm-t">{messageOf(activity.error)}</p> : null}
          {(activity.data ?? []).map((entry, index) => (
            <ActivityRow key={entry.id} entry={entry} recordType="company" first={index === 0} />
          ))}
        </section>
      </div>
    </aside>
  )
}

function EditableAddress(props: {
  readonly value: PostalAddress | null
  readonly onSave: (address: PostalAddress | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const formRef = useRef<HTMLFieldSetElement>(null)
  const value = props.value
  const save = () => {
    const root = formRef.current
    setEditing(false)
    if (!root) return
    const read = (name: string) =>
      (root.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() ?? ""
    const next = addressFrom(read)
    if (JSON.stringify(next) !== JSON.stringify(value)) props.onSave(next)
  }
  if (editing) {
    return (
      <div className="field">
        <span className="flabel sm-t">Address</span>
        <fieldset
          className="fval"
          style={{ padding: "0 6px", cursor: "default", border: 0, minInlineSize: 0 }}
          ref={formRef}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") save()
            if (event.key === "Escape") {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        >
          <legend className="vh">Address</legend>
          <AddressInputs idPrefix="eco" value={value} />
          <div style={{ display: "flex", gap: 6, margin: "8px 0 4px" }}>
            <button className="btn sm primary" type="button" onClick={save}>
              Save
            </button>
            <button className="btn sm ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </fieldset>
      </div>
    )
  }
  const locality = value ? [value.city, value.region, value.postcode].filter(Boolean).join(" ") : ""
  return (
    <div className="field">
      <span className="flabel sm-t">Address</span>
      <button className="fval" type="button" onClick={() => setEditing(true)}>
        {value ? (
          <span className="addr">
            {value.line1 ? <span>{value.line1}</span> : null}
            {value.line2 ? <span>{value.line2}</span> : null}
            {locality ? <span>{locality}</span> : null}
            {value.country ? <span>{countryName(value.country)}</span> : null}
          </span>
        ) : (
          <span className="empty-v">Empty</span>
        )}
      </button>
    </div>
  )
}
