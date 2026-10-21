import { type Company, normalizeDomain, type PostalAddress, type TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { type CompanyDraft, primaryDomainOf, refreshCompanies, saveCompany, writeCompany } from "../lib/companies.ts"
import { refreshContacts } from "../lib/contacts.ts"
import { COUNTRIES, countryName } from "../lib/countries.ts"
import { useFields } from "../lib/custom-fields.ts"
import { CompanyContacts, type ToastRequest } from "./affiliations.tsx"
import { CustomFieldsSection } from "./custom-fields.tsx"
import { TrashIcon } from "./icons.tsx"
import { CompanyLogo, ImageEditor } from "./images.tsx"
import {
  EditableList,
  EditableText,
  EmptyValue,
  PanelBar,
  PanelIdentity,
  PanelSubtitle,
  propertyFieldsetClass,
  toE164,
} from "./record.tsx"
import { RecordOwnerField } from "./record-owner.tsx"
import { EditableDescription, EditableNumber, SocialProfilesField } from "./record-profile.tsx"
import { Timeline } from "./timeline.tsx"
import { Button as ButtonPrimitive } from "./ui/button.tsx"
import { DropdownMenuItem } from "./ui/dropdown-menu.tsx"
import {
  Button,
  cn,
  InlineInput,
  PanelBody,
  PanelHeader,
  PropertyRow,
  propertyValueClass,
  RecordPanel,
  readableColumnClass,
  Section,
  Select,
} from "./ui/index.ts"

export type Draft = CompanyDraft
export type Domain = Company["domains"][number]["domain"]

/** What people type into a website field, as a URL: "acme.com" → "https://acme.com". */
export const toWebsite = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`)

export const contactsLabel = (count: number) => (count === 0 ? "None" : String(count))

export const ADDRESS_FIELDS = [
  { key: "line1", label: "Street", full: true },
  { key: "line2", label: "Street, line 2", full: true },
  { key: "city", label: "City", full: false },
  { key: "region", label: "Region", full: false },
  { key: "postcode", label: "Postcode", full: false },
] as const

/** The address from a form, or null when every part is empty. */
export const addressFrom = (read: (name: string) => string): PostalAddress | null => {
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

export function AddressInputs(props: { readonly idPrefix: string; readonly value: PostalAddress | null }) {
  return (
    <div className="grid grid-cols-2 gap-x-3">
      {ADDRESS_FIELDS.map((field) => (
        <div key={field.key} className={cn(field.full && "col-span-2")}>
          <AddressLabel htmlFor={`${props.idPrefix}-${field.key}`}>{field.label}</AddressLabel>
          <InlineInput
            id={`${props.idPrefix}-${field.key}`}
            name={field.key}
            type="text"
            autoComplete="off"
            placeholder="Empty"
            maxLength={field.key === "postcode" ? 20 : 200}
            defaultValue={props.value?.[field.key] ?? ""}
          />
        </div>
      ))}
      <div>
        <AddressLabel htmlFor={`${props.idPrefix}-country`}>Country</AddressLabel>
        <Select
          variant="inline"
          id={`${props.idPrefix}-country`}
          name="country"
          defaultValue={props.value?.country ?? ""}
        >
          <option value="">Choose…</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

function AddressLabel(props: { readonly htmlFor: string; readonly children: string }) {
  return (
    <label className="mt-1 block text-xs text-subtle" htmlFor={props.htmlFor}>
      {props.children}
    </label>
  )
}

/** A domain problem in our words, with a way to the company that has it. */
export function CompanyPanel(props: {
  readonly company: Company
  readonly teamId: TeamId
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onToast: (toast: ToastRequest) => void
  readonly canWrite: boolean
  /** A panel beside the list, or the full record view at its own URL (D55). */
  readonly layout?: "panel" | "full"
  readonly onToggleLayout?: () => void
}) {
  const { company } = props
  const queryClient = useQueryClient()
  const { fields } = useFields(props.teamId, "company")
  const activity = useQuery({
    queryKey: ["company-activity", props.teamId, company.id, company.updatedAt, company.contactCount],
    queryFn: () => call("companies.activity", { teamId: props.teamId, companyId: company.id }),
  })
  const domain = primaryDomainOf(company)

  const save = (change: (draft: Draft) => void) => {
    saveCompany(queryClient, props.teamId, company, change)
      .then(async (saved) => {
        await queryClient.invalidateQueries({ queryKey: ["company-activity", props.teamId, company.id] })
        // Adding a domain can affiliate contacts (D105), so contacts and counts are refreshed.
        if (JSON.stringify(saved.domains) !== JSON.stringify(company.domains)) {
          await refreshCompanies(queryClient, props.teamId)
          await refreshContacts(queryClient, props.teamId)
          await queryClient.invalidateQueries({ queryKey: ["affiliations", props.teamId, company.id] })
        }
      })
      .catch((failure: unknown) => props.onToast({ text: messageOf(failure) }))
  }

  /** Uploads or removes the logo. Removing one fetches the domain's icon again, in the background. */
  const setLogo = async (image: string | null) => {
    try {
      const updated =
        image === null
          ? await call("companies.removeLogo", { teamId: props.teamId, companyId: company.id })
          : await call("companies.setLogo", { teamId: props.teamId, companyId: company.id, image })
      writeCompany(queryClient, props.teamId, updated)
      await queryClient.invalidateQueries({ queryKey: ["company-activity", props.teamId, company.id] })
    } catch (failure) {
      props.onToast({ text: messageOf(failure) })
    }
  }

  const full = props.layout === "full"
  return (
    <RecordPanel full={full} aria-label={`Company ${company.name}`}>
      <PanelHeader className={cn(full && readableColumnClass)}>
        <PanelBar
          noun="company"
          position={props.position}
          onMove={props.onMove}
          layout={props.layout}
          onToggleLayout={props.onToggleLayout}
          onClose={props.onClose}
          menu={() => (
            <DropdownMenuItem variant="destructive" onClick={props.onDelete}>
              <TrashIcon className="size-4" />
              Delete company
            </DropdownMenuItem>
          )}
        />
        <PanelIdentity
          name={company.name}
          mark={
            <ImageEditor
              label="logo"
              hasUpload={company.logoUrl !== null}
              canEdit={props.canWrite}
              onUpload={(image) => setLogo(image)}
              onRemove={() => setLogo(null)}
            >
              <CompanyLogo company={company} size="lg" />
            </ImageEditor>
          }
        >
          <PanelSubtitle>
            {[domain, `${company.contactCount} ${company.contactCount === 1 ? "contact" : "contacts"}`]
              .filter(Boolean)
              .join(" · ")}
          </PanelSubtitle>
        </PanelIdentity>
      </PanelHeader>
      <PanelBody className={cn(full && readableColumnClass)}>
        <Section>
          <EditableDescription
            value={company.description}
            disabled={!props.canWrite}
            onSave={(value) =>
              save((draft) => {
                draft.description = value
              })
            }
          />
        </Section>
        <Section>
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
          <SocialProfilesField
            profiles={company.socialProfiles}
            disabled={!props.canWrite}
            onSave={(profiles) =>
              save((draft) => {
                draft.socialProfiles = [...profiles]
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
          <EditableText
            label="Industry"
            value={company.industry}
            onSave={(value) =>
              save((draft) => {
                draft.industry = value
              })
            }
          />
          <EditableNumber
            label="Employees"
            whole
            min={0}
            value={company.employees}
            onSave={(value) =>
              save((draft) => {
                draft.employees = value
              })
            }
          />
          <EditableNumber
            label="Year founded"
            whole
            grouped={false}
            min={1000}
            max={2100}
            value={company.yearFounded}
            onSave={(value) =>
              save((draft) => {
                draft.yearFounded = value
              })
            }
          />
          <EditableNumber
            label="Annual revenue"
            min={0}
            value={company.annualRevenue}
            onSave={(value) =>
              save((draft) => {
                draft.annualRevenue = value
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
          <RecordOwnerField
            teamId={props.teamId}
            label="Company owner"
            ownerId={company.ownerId}
            ownerName={company.ownerName}
            disabled={!props.canWrite}
            onChange={(owner) =>
              save((draft) => {
                draft.ownerId = owner?.id ?? null
                draft.ownerName = owner?.name ?? null
              })
            }
          />
        </Section>
        <CustomFieldsSection
          fields={fields}
          values={company.custom}
          onSave={(field, value) =>
            save((draft) => {
              const next = { ...draft.custom }
              if (value === null) delete next[field.id]
              else next[field.id] = value
              draft.custom = next
            })
          }
        />
        <CompanyContacts company={company} teamId={props.teamId} onToast={props.onToast} />
        <Timeline
          teamId={props.teamId}
          recordType="company"
          recordId={company.id}
          activity={activity.data}
          activityLoading={activity.isLoading}
          activityError={activity.isError ? messageOf(activity.error) : undefined}
          onError={(text) => props.onToast({ text })}
        />
      </PanelBody>
    </RecordPanel>
  )
}

/** A record's postal address (D104, D128): a summary, and the fields to edit it in place. */
export function EditableAddress(props: {
  readonly value: PostalAddress | null
  readonly onSave: (address: PostalAddress | null) => void
  /** Prefixes the inputs' ids, so a company's and a contact's never clash. */
  readonly idPrefix?: string
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
      <PropertyRow label="Address">
        <fieldset
          className={cn(propertyFieldsetClass, "cursor-default")}
          ref={formRef}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") save()
            if (event.key === "Escape") {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        >
          <legend className="sr-only">Address</legend>
          <AddressInputs idPrefix={props.idPrefix ?? "eco"} value={value} />
          <div className="mt-2 mb-1 flex gap-1.5">
            <Button size="sm" variant="primary" onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      </PropertyRow>
    )
  }
  const locality = value ? [value.city, value.region, value.postcode].filter(Boolean).join(" ") : ""
  return (
    <PropertyRow label="Address">
      <ButtonPrimitive variant={null} size="none" className={propertyValueClass} onClick={() => setEditing(true)}>
        {value ? (
          <span className="flex flex-col">
            {value.line1 ? <span>{value.line1}</span> : null}
            {value.line2 ? <span>{value.line2}</span> : null}
            {locality ? <span>{locality}</span> : null}
            {value.country ? <span>{countryName(value.country)}</span> : null}
          </span>
        ) : (
          <EmptyValue />
        )}
      </ButtonPrimitive>
    </PropertyRow>
  )
}
