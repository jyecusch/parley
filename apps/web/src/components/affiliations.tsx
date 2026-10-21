import type { Affiliation, Company, CompanyId, Contact, ContactAffiliation, ContactId, TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, type RefObject, useMemo, useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { companyApi, primaryDomainOf, refreshCompanies } from "../lib/companies.ts"
import { contactApi, refreshContacts } from "../lib/contacts.ts"
import { useRecordSearch } from "../lib/records.ts"
import { ChoiceItem, ChoiceList } from "./choice-list.tsx"
import { CloseIcon, PlusIcon } from "./icons.tsx"
import { PopoverAnchor } from "./popover-anchor.tsx"
import { initialsOfName } from "./record.tsx"
import { Dialog } from "./settings.tsx"
import { Button as PlainButton } from "./ui/button.tsx"
import { Command, CommandFooter, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command.tsx"
import {
  Avatar,
  Button,
  cn,
  ErrorText,
  Field,
  Hint,
  IconButton,
  Input,
  Section,
  SectionHeader,
  Skeleton,
  SmallInput,
} from "./ui/index.ts"
import { Popover, PopoverContent } from "./ui/popover.tsx"

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
      refreshContacts(queryClient, teamId),
      refreshCompanies(queryClient, teamId),
      queryClient.invalidateQueries({ queryKey: ["affiliations", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["contact-activity", teamId] }),
      queryClient.invalidateQueries({ queryKey: ["company-activity", teamId] }),
    ])
  }
}

/** A company as a chip: its mark and name, and in the panel the contact's title there. */
function AffiliationChip(props: {
  readonly companyName: string
  readonly title?: string | null | undefined
  readonly tooltip?: string | undefined
}) {
  return (
    <span
      className="inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md bg-fill pr-2 pl-1 text-sm"
      title={props.tooltip}
    >
      <Avatar shape="square">{initialsOfName(props.companyName)}</Avatar>
      <span className="truncate">{props.companyName}</span>
      {props.title ? <span className="truncate text-subtle">{props.title}</span> : null}
    </span>
  )
}

/** In the contacts table: up to two companies, then "+N"; titles are in the tooltip (D113). */
export function AffiliationChips(props: { readonly affiliations: ReadonlyArray<ContactAffiliation> }) {
  if (props.affiliations.length === 0) return <span className="text-subtle">—</span>
  const shown = props.affiliations.slice(0, 2)
  const rest = props.affiliations.slice(2)
  const label = (affiliation: ContactAffiliation) =>
    affiliation.title ? `${affiliation.companyName} · ${affiliation.title}` : affiliation.companyName
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((affiliation) => (
        <AffiliationChip key={affiliation.id} companyName={affiliation.companyName} tooltip={label(affiliation)} />
      ))}
      {rest.length > 0 ? (
        <span
          className="inline-grid h-5.5 shrink-0 place-items-center rounded-sm bg-fill px-1.5 text-xs text-subtle"
          title={rest.map(label).join("\n")}
        >
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
    <div className="flex flex-wrap gap-1">
      {props.affiliations.map((affiliation) => (
        <AffiliationChip key={affiliation.id} companyName={affiliation.companyName} title={affiliation.title} />
      ))}
    </div>
  )
}

/** A contact or company in a panel's list, with actions that show on hover. */
function AffiliationRow(props: {
  readonly mark: ReactNode
  readonly children: ReactNode
  readonly actions: ReactNode
  readonly editing?: boolean
}) {
  return (
    <div
      className={cn(
        "group/arow -mx-1.5 flex min-h-10 items-center gap-2.5 rounded-md pr-1 pl-1.5 hover:bg-hover",
        props.editing && "bg-hover",
      )}
    >
      {props.mark}
      {props.children}
      <span
        className={cn(
          "flex opacity-0 group-focus-within/arow:opacity-100 group-hover/arow:opacity-100",
          props.editing && "opacity-100",
        )}
      >
        {props.actions}
      </span>
    </div>
  )
}

/** The classes for the other record's link in an affiliation row: its name, with the title underneath. */
const affiliationLinkClass = "group/who flex min-w-0 flex-1 flex-col items-start text-inherit no-underline"

function AffiliationName(props: { readonly name: string; readonly title: ReactNode }) {
  return (
    <>
      <span className="max-w-full truncate font-medium decoration-line-strong underline-offset-3 group-hover/who:underline">
        {props.name}
      </span>
      {props.title ? <span className="max-w-full truncate text-sm text-subtle">{props.title}</span> : null}
    </>
  )
}

export interface PickerItem {
  readonly id: string
  readonly name: string
  readonly sub: string | undefined
  readonly avatar: ReactNode
}

/**
 * A searchable list in a popover (shadcn's Popover and Command). Arrow keys move, Enter picks,
 * Escape and clicks outside close it.
 */
export function Picker(props: {
  readonly label: string
  readonly placeholder: string
  readonly heading: string
  readonly items: ReadonlyArray<PickerItem>
  readonly onPick: (id: string) => void
  readonly onCreate?: (name: string) => void
  readonly createLabel?: (name: string) => string
  readonly onClose: () => void
  /**
   * Where its top-right corner sits, as classes relative to the positioned element around it.
   * Defaults to below the section header, from the right.
   */
  readonly placement?: string
  /** For items searched on the server (D136): gets what's typed, and `items` are taken as matches. */
  readonly onQueryChange?: (query: string) => void
  /** The button that opened it, which gets focus back when it closes. */
  readonly returnFocus?: RefObject<HTMLElement | null>
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const matches = (
    props.onQueryChange
      ? props.items
      : props.items.filter((item) => !q || item.name.toLowerCase().includes(q) || item.sub?.toLowerCase().includes(q))
  ).slice(0, 8)
  const canCreate = props.onCreate !== undefined && query.trim() !== ""
  return (
    <Popover open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <PopoverAnchor className={props.placement ?? "top-10 right-2"} />
      <PopoverContent align="end" sideOffset={0} aria-label={props.label} finalFocus={props.returnFocus ?? true}>
        <Command shouldFilter={false} label={props.label}>
          <CommandInput
            placeholder={props.placeholder}
            aria-label={props.placeholder}
            autoComplete="off"
            value={query}
            onValueChange={(value) => {
              setQuery(value)
              props.onQueryChange?.(value)
            }}
          />
          <CommandList>
            <CommandGroup heading={props.heading} forceMount>
              {matches.map((item) => (
                <CommandItem key={item.id} value={item.id} trailing={item.sub} onSelect={() => props.onPick(item.id)}>
                  {item.avatar}
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {matches.length === 0 ? <p className="m-0 px-2 pt-2 pb-1 text-sm text-subtle">Nothing matches.</p> : null}
          </CommandList>
          {canCreate ? (
            <CommandFooter>
              <CommandItem value="create" onSelect={() => props.onCreate?.(query.trim())}>
                <span className="grid size-5.5 shrink-0 place-items-center">
                  <PlusIcon className="size-4" />
                </span>
                <span className="truncate">{props.createLabel?.(query.trim())}</span>
              </CommandItem>
            </CommandFooter>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The contact panel's Companies section: each company with its title, editable, removable, and a picker. */
export function ContactCompanies(props: {
  readonly contact: Contact
  readonly teamId: TeamId
  readonly onToast: (toast: ToastRequest) => void
}) {
  const { contact, teamId } = props
  const refresh = useRefreshAfterChange(teamId)
  const [picking, setPicking] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState("")
  const found = useRecordSearch(companyApi, teamId, query, { enabled: picking })
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
    return found.items
      .filter((company: Company) => !linked.has(company.id))
      .map(
        (company): PickerItem => ({
          id: company.id,
          name: company.name,
          sub: primaryDomainOf(company),
          avatar: <Avatar shape="square">{initialsOfName(company.name)}</Avatar>,
        }),
      )
  }, [found.items, contact.affiliations])

  return (
    <Section className="relative">
      <SectionHeader>
        <span>
          Companies
          <SectionCount count={contact.affiliations.length} />
        </span>
        <PlainButton
          ref={opener}
          type="button"
          variant="text"
          size="none"
          className="text-sm"
          aria-haspopup="dialog"
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <PlusIcon className="size-3.5" />
          Add to company
        </PlainButton>
      </SectionHeader>
      {contact.affiliations.length === 0 ? <SectionEmpty>Not affiliated with a company.</SectionEmpty> : null}
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
          <AffiliationRow
            key={affiliation.id}
            mark={
              <Avatar size="md" shape="square">
                {initialsOfName(affiliation.companyName)}
              </Avatar>
            }
            actions={
              <>
                <IconButton
                  size="xs"
                  label={`Edit title at ${affiliation.companyName}`}
                  tip="Edit title"
                  onClick={() => setEditing(affiliation.id)}
                >
                  <PencilIcon />
                </IconButton>
                <IconButton
                  size="xs"
                  label={`Remove from ${affiliation.companyName}`}
                  tip={`Remove from ${affiliation.companyName}`}
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
                  <CloseIcon className="size-3.5" />
                </IconButton>
              </>
            }
          >
            <Link
              className={affiliationLinkClass}
              to="/t/$teamId/companies"
              params={{ teamId }}
              search={{ company: affiliation.companyId }}
            >
              <AffiliationName name={affiliation.companyName} title={affiliation.title ?? "No title"} />
            </Link>
          </AffiliationRow>
        ),
      )}
      {picking ? (
        <Picker
          label={`Add ${contact.displayName} to a company`}
          placeholder="Search companies…"
          heading="Companies"
          items={items}
          onQueryChange={setQuery}
          returnFocus={opener}
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
    </Section>
  )
}

/** The company panel's Contacts section: each affiliated contact with its title, removable, and a picker. */
export function CompanyContacts(props: {
  readonly company: Company
  readonly teamId: TeamId
  readonly onToast: (toast: ToastRequest) => void
}) {
  const { company, teamId } = props
  const refresh = useRefreshAfterChange(teamId)
  const [picking, setPicking] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState("")
  const found = useRecordSearch(contactApi, teamId, query, { enabled: picking })
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
    return found.items
      .filter((contact: Contact) => !linked.has(contact.id))
      .map(
        (contact): PickerItem => ({
          id: contact.id,
          name: contact.displayName,
          sub: contact.emails[0]?.address,
          avatar: <Avatar>{initialsOfName(contact.displayName)}</Avatar>,
        }),
      )
  }, [found.items, rows])

  return (
    <Section className="relative">
      <SectionHeader>
        <span>
          Contacts
          <SectionCount count={rows.length} />
        </span>
        <PlainButton
          ref={opener}
          type="button"
          variant="text"
          size="none"
          className="text-sm"
          aria-haspopup="dialog"
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
        >
          <PlusIcon className="size-3.5" />
          Add contact
        </PlainButton>
      </SectionHeader>
      {affiliations.isLoading ? <Skeleton className="my-2 w-[60%]" /> : null}
      {affiliations.isError ? <ErrorText className="my-1">{messageOf(affiliations.error)}</ErrorText> : null}
      {affiliations.isSuccess && rows.length === 0 ? (
        <SectionEmpty>No contacts yet. Contacts with an email at its domains join on their own.</SectionEmpty>
      ) : null}
      {rows.map((affiliation: Affiliation) => (
        <AffiliationRow
          key={affiliation.id}
          mark={<Avatar>{initialsOfName(affiliation.contactName)}</Avatar>}
          actions={
            <IconButton
              size="xs"
              label={`Remove ${affiliation.contactName} from ${company.name}`}
              tip={`Remove from ${company.name}`}
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
              <CloseIcon className="size-3.5" />
            </IconButton>
          }
        >
          <Link
            className={affiliationLinkClass}
            to="/t/$teamId/contacts"
            params={{ teamId }}
            search={{ contact: affiliation.contactId }}
          >
            <AffiliationName name={affiliation.contactName} title={affiliation.title} />
          </Link>
        </AffiliationRow>
      ))}
      {picking ? (
        <Picker
          label={`Add a contact to ${company.name}`}
          placeholder="Search contacts…"
          heading="Contacts"
          items={items}
          onQueryChange={setQuery}
          returnFocus={opener}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false)
            void run(() => affiliate(id as ContactId, null))
          }}
        />
      ) : null}
    </Section>
  )
}

/** How many items a panel section lists, after its heading. */
function SectionCount(props: { readonly count: number }) {
  return props.count ? <span className="ml-1 font-normal text-subtle">{props.count}</span> : null
}

function SectionEmpty(props: { readonly children: ReactNode }) {
  return <p className="m-0 text-sm text-subtle">{props.children}</p>
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
    <AffiliationRow
      editing
      mark={
        <Avatar size="md" shape="square">
          {initialsOfName(props.name)}
        </Avatar>
      }
      actions={
        <Button size="sm" variant="primary" onClick={save}>
          Save
        </Button>
      }
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-1">
        <span className="truncate font-medium">{props.name}</span>
        <SmallInput
          aria-label={`Title at ${props.name}`}
          placeholder="Title, like CTO"
          maxLength={100}
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
    </AffiliationRow>
  )
}

const PencilIcon = () => (
  <svg
    className="size-3.5"
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
  readonly teamId: TeamId
  readonly count: number
  readonly onApply: (companyId: string, title: string | null) => Promise<void>
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [companyId, setCompanyId] = useState<string>()
  const [title, setTitle] = useState("")
  // Searched on the server as you type (D136).
  const found = useRecordSearch(companyApi, props.teamId, query, { limit: 50 })
  const matches = found.items.map((company) => ({ id: company.id as string, label: company.name }))
  return (
    <Dialog
      title={`Add ${props.count.toLocaleString()} ${props.count === 1 ? "contact" : "contacts"} to a company`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!companyId}
            onClick={() => companyId && void props.onApply(companyId, title.trim() || null)}
          >
            Add to company
          </Button>
        </>
      }
    >
      <Field label="Company" htmlFor="affiliate-search">
        <Input
          id="affiliate-search"
          type="text"
          placeholder="Search companies…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ChoiceList label="Company" value={companyId} onChange={setCompanyId} className="max-h-60 overflow-auto p-1">
          {matches.length === 0 && !found.isSearching ? <Hint className="p-1.5">No companies match.</Hint> : null}
          {matches.map((company) => (
            <ChoiceItem key={company.id} value={company.id}>
              <Avatar shape="square">{initialsOfName(company.label)}</Avatar>
              <span className="truncate">{company.label}</span>
            </ChoiceItem>
          ))}
        </ChoiceList>
      </Field>
      <Field
        label={
          <>
            Title <span className="font-normal text-subtle">(optional)</span>
          </>
        }
        htmlFor="affiliate-title"
      >
        <Input
          id="affiliate-title"
          type="text"
          maxLength={100}
          placeholder="Title, like CTO"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
    </Dialog>
  )
}
