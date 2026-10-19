import type { Contact, TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { type contactsCollection, displayNameOf } from "../lib/contacts.ts"
import { useFields } from "../lib/custom-fields.ts"
import { AffiliationTags, ContactCompanies } from "./affiliations.tsx"
import { CustomFieldsSection } from "./custom-fields.tsx"
import { ChevronDown, ChevronUp, CloseIcon, CollapseIcon, ExpandIcon, MoreIcon, TrashIcon } from "./icons.tsx"
import { ContactAvatar, ImageEditor } from "./images.tsx"
import { EditableList, EditableText, toE164 } from "./record.tsx"
import { SubscriptionSection } from "./subscriptions.tsx"
import { Timeline } from "./timeline.tsx"

/** A toast the contacts screen shows, with an optional undo. */
export interface Toast {
  readonly text: string
  readonly undo?: () => void
}

type Draft = { -readonly [K in keyof Contact]: Contact[K] }

export function ContactPanel(props: {
  readonly contact: Contact
  readonly teamId: TeamId
  readonly position: { readonly index: number; readonly total: number }
  readonly onMove: (delta: number) => void
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onError: (text: UserText) => void
  readonly onToast: (toast: Toast) => void
  readonly collection: ReturnType<typeof contactsCollection>
  readonly canWrite: boolean
  /** A panel beside the list, or the full record view at its own URL (D55). */
  readonly layout?: "panel" | "full"
  readonly onToggleLayout?: () => void
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

  /** Uploads or removes the avatar, then shows what the server stored. */
  const setAvatar = async (image: string | null) => {
    try {
      const updated =
        image === null
          ? await call("contacts.removeAvatar", { teamId: props.teamId, contactId: contact.id })
          : await call("contacts.setAvatar", { teamId: props.teamId, contactId: contact.id, image })
      collection.utils.writeUpsert(updated)
      await queryClient.invalidateQueries({ queryKey: ["contact-activity", props.teamId, contact.id] })
    } catch (failure) {
      props.onError(messageOf(failure))
    }
  }

  return (
    <aside
      className={`card panel ${props.layout === "full" ? "record" : ""}`}
      aria-label={`Contact ${contact.displayName}`}
    >
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
          <ImageEditor
            label="avatar"
            hasUpload={contact.avatarUrl !== null}
            canEdit={props.canWrite}
            onUpload={(image) => setAvatar(image)}
            onRemove={() => setAvatar(null)}
          >
            <ContactAvatar contact={contact} size="lg" />
          </ImageEditor>
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
        <SubscriptionSection
          contact={contact}
          teamId={props.teamId}
          canWrite={props.canWrite}
          onError={props.onError}
          onStatus={(status) =>
            save((draft) => {
              draft.subscriptionStatus = status
            })
          }
        />
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
