import { type Company, normalizeDomain, type PostalAddress, type TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { type companiesCollection, primaryDomainOf } from "../lib/companies.ts"
import { COUNTRIES, countryName } from "../lib/countries.ts"
import { useFields } from "../lib/custom-fields.ts"
import { CompanyContacts, type ToastRequest } from "./affiliations.tsx"
import { CustomFieldsSection } from "./custom-fields.tsx"
import { ChevronDown, ChevronUp, CloseIcon, CollapseIcon, ExpandIcon, MoreIcon, TrashIcon } from "./icons.tsx"
import { CompanyLogo, ImageEditor } from "./images.tsx"
import { EditableList, EditableText, toE164 } from "./record.tsx"
import { Timeline } from "./timeline.tsx"

export type Draft = { -readonly [K in keyof Company]: Company[K] }
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
    <div className="addr-grid">
      {ADDRESS_FIELDS.map((field) => (
        <div key={field.key} className={field.full ? "full" : undefined}>
          <label className="sublabel" htmlFor={`${props.idPrefix}-${field.key}`}>
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
        <label className="sublabel" htmlFor={`${props.idPrefix}-country`}>
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
export function CompanyPanel(props: {
  readonly company: Company
  readonly teamId: TeamId
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onToast: (toast: ToastRequest) => void
  readonly collection: ReturnType<typeof companiesCollection>
  readonly canWrite: boolean
  /** A panel beside the list, or the full record view at its own URL (D55). */
  readonly layout?: "panel" | "full"
  readonly onToggleLayout?: () => void
}) {
  const { company, collection } = props
  const queryClient = useQueryClient()
  const { fields } = useFields(props.teamId, "company")
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

  /** Uploads or removes the logo. Removing one fetches the domain's icon again, in the background. */
  const setLogo = async (image: string | null) => {
    try {
      const updated =
        image === null
          ? await call("companies.removeLogo", { teamId: props.teamId, companyId: company.id })
          : await call("companies.setLogo", { teamId: props.teamId, companyId: company.id, image })
      collection.utils.writeUpsert(updated)
      await queryClient.invalidateQueries({ queryKey: ["company-activity", props.teamId, company.id] })
    } catch (failure) {
      props.onToast({ text: messageOf(failure) })
    }
  }

  return (
    <aside className={`card panel ${props.layout === "full" ? "record" : ""}`} aria-label={`Company ${company.name}`}>
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
            <ChevronDown className="size-5" />
          </button>
          <span className="pos sm-t tab">
            {props.position.index + 1} of {props.position.total}
          </span>
          <div className="spacer" />
          {props.onToggleLayout ? (
            <button
              className="ibtn tip tip-b"
              type="button"
              aria-label={props.layout === "full" ? "Back to the panel" : "Open full page"}
              data-tip={props.layout === "full" ? "Back to the list" : "Open full page"}
              onClick={props.onToggleLayout}
            >
              {props.layout === "full" ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          ) : null}
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
                  <TrashIcon className="size-4" />
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
          <ImageEditor
            label="logo"
            hasUpload={company.logoUrl !== null}
            canEdit={props.canWrite}
            onUpload={(image) => setLogo(image)}
            onRemove={() => setLogo(null)}
          >
            <CompanyLogo company={company} size="lg" />
          </ImageEditor>
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
