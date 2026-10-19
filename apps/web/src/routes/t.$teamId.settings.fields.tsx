import {
  type CustomField,
  type CustomFieldType,
  type RecordType,
  ROLE_PERMISSIONS,
  type SelectOption,
  type TeamId,
} from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { ChevronDown, ChevronUp, CloseIcon, DisplayIcon, InfoIcon, PlusIcon } from "../components/icons.tsx"
import { Dialog, Empty, LoadFailed, LoadingRows, SettingsPage, useToast } from "../components/settings.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/fields")({ component: Fields })

const team = getRouteApi("/t/$teamId")

const TYPES: ReadonlyArray<{ readonly type: CustomFieldType; readonly label: string; readonly hint: string }> = [
  { type: "text", label: "Text", hint: "Anything, up to 2,000 characters." },
  { type: "number", label: "Number", hint: "Seats, revenue, a score." },
  { type: "date", label: "Date", hint: "A day, like a renewal date." },
  { type: "checkbox", label: "Checkbox", hint: "Yes or no." },
  { type: "single-select", label: "Single select", hint: "One of a list of options." },
  { type: "multi-select", label: "Multi select", hint: "Any of a list of options." },
  { type: "url", label: "URL", hint: "A web address." },
  { type: "email", label: "Email", hint: "An email address." },
  { type: "phone", label: "Phone", hint: "A phone number, stored in international format." },
]
const typeLabel = (type: CustomFieldType) => TYPES.find((entry) => entry.type === type)?.label ?? type
const isSelect = (type: CustomFieldType) => type === "single-select" || type === "multi-select"

/** A new option's id: a short slug of its label plus a little randomness, so it never collides. */
const optionId = (label: string) =>
  `${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)}-${crypto.randomUUID().slice(0, 6)}`

function Fields() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("fields:manage")
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const [recordType, setRecordType] = useState<RecordType>("contact")
  const [dialog, setDialog] = useState<"new" | CustomField>()
  const [confirming, setConfirming] = useState<string>()
  const key = ["fields", teamId]
  const fields = useQuery({ queryKey: key, queryFn: () => call("fields.list", { teamId }) })
  const shown = (fields.data ?? []).filter((field) => field.recordType === recordType)
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const move = async (field: CustomField, delta: number) => {
    const index = shown.indexOf(field)
    const other = shown[index + delta]
    if (!other) return
    try {
      await call("fields.update", { teamId, fieldId: field.id, position: other.position })
      await call("fields.update", { teamId, fieldId: other.id, position: field.position })
    } catch (failure) {
      showToast(messageOf(failure))
    }
    await refresh()
  }

  const remove = async (field: CustomField) => {
    try {
      await call("fields.delete", { teamId, fieldId: field.id })
      showToast(`${field.name} is deleted, with its value on every record.`)
    } catch (failure) {
      showToast(messageOf(failure))
    }
    setConfirming(undefined)
    await refresh()
  }

  return (
    <SettingsPage
      title="Fields"
      intro={`Custom fields hold what ${current.name} tracks beyond the built-in ones, like a plan, a renewal date or an account owner. Agents see them too, and set them by field id.`}
      action={
        canManage ? (
          <button className="btn primary sm" type="button" onClick={() => setDialog("new")}>
            New field
          </button>
        ) : null
      }
    >
      <div className="seg" role="radiogroup" aria-label="Record type">
        {(["contact", "company"] as const).map((type) => (
          <label key={type} className={recordType === type ? "on" : ""}>
            <input type="radio" name="record-type" checked={recordType === type} onChange={() => setRecordType(type)} />
            {type === "contact" ? "Contacts" : "Companies"}
          </label>
        ))}
      </div>
      {canManage ? null : (
        <div className="notice">
          <span className="ic">
            <InfoIcon />
          </span>
          <span>Only admins and owners can add or change fields. You can fill them in on any record.</span>
        </div>
      )}
      {fields.isPending ? (
        <LoadingRows />
      ) : fields.isError ? (
        <LoadFailed
          title="Fields didn't load"
          message={messageOf(fields.error)}
          onRetry={() => void fields.refetch()}
        />
      ) : shown.length === 0 ? (
        <Empty
          icon={<DisplayIcon size={16} />}
          title={`No fields on ${recordType === "contact" ? "contacts" : "companies"} yet`}
        >
          {canManage
            ? "Add one for anything your team tracks that isn't built in."
            : "An admin can add fields for anything your team tracks that isn't built in."}
        </Empty>
      ) : (
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col" style={{ width: "34%" }}>
                  Name
                </th>
                <th scope="col" style={{ width: "18%" }}>
                  Type
                </th>
                <th scope="col">Options</th>
                <th scope="col" style={{ width: 190 }}>
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((field, index) => (
                <tr key={field.id}>
                  <td>
                    <span className="who">
                      <span className="n">{field.name}</span>
                    </span>
                  </td>
                  <td className="c-muted">{typeLabel(field.type)}</td>
                  <td className="c-muted" title={field.options.map((option) => option.label).join(", ")}>
                    {isSelect(field.type) ? field.options.map((option) => option.label).join(", ") : "—"}
                  </td>
                  <td className="c-act">
                    {!canManage ? null : confirming === field.id ? (
                      <span className="confirm">
                        <button className="btn sm ghost" type="button" onClick={() => setConfirming(undefined)}>
                          Cancel
                        </button>
                        <button
                          className="btn sm danger-solid"
                          type="button"
                          aria-label={`Confirm: delete ${field.name}`}
                          onClick={() => void remove(field)}
                        >
                          Delete
                        </button>
                      </span>
                    ) : (
                      <span className="confirm">
                        <button
                          className="ibtn xs"
                          type="button"
                          aria-label={`Move ${field.name} up`}
                          disabled={index === 0}
                          onClick={() => void move(field, -1)}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          className="ibtn xs"
                          type="button"
                          aria-label={`Move ${field.name} down`}
                          disabled={index === shown.length - 1}
                          onClick={() => void move(field, 1)}
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button className="btn sm ghost" type="button" onClick={() => setDialog(field)}>
                          Edit
                        </button>
                        <button
                          className="btn sm danger"
                          type="button"
                          aria-label={`Delete ${field.name}`}
                          onClick={() => setConfirming(field.id)}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? (
        <FieldDialog
          teamId={teamId}
          recordType={recordType}
          field={dialog === "new" ? undefined : dialog}
          onClose={() => setDialog(undefined)}
          onSaved={async (field, created) => {
            setDialog(undefined)
            showToast(created ? `${field.name} is added to every ${field.recordType}.` : `${field.name} is saved.`)
            await refresh()
          }}
        />
      ) : null}
      {toast}
    </SettingsPage>
  )
}

function FieldDialog(props: {
  readonly teamId: TeamId
  readonly recordType: RecordType
  readonly field: CustomField | undefined
  readonly onClose: () => void
  readonly onSaved: (field: CustomField, created: boolean) => Promise<void>
}) {
  const editing = props.field
  const [name, setName] = useState(editing?.name ?? "")
  const [type, setType] = useState<CustomFieldType>(editing?.type ?? "text")
  const [options, setOptions] = useState<ReadonlyArray<SelectOption>>(editing?.options ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const cleanOptions = options
    .map((option) => ({ ...option, label: option.label.trim() }))
    .filter((option) => option.label !== "")

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const field = editing
        ? await call("fields.update", {
            teamId: props.teamId,
            fieldId: editing.id,
            name: name.trim(),
            ...(isSelect(editing.type) ? { options: cleanOptions } : {}),
          })
        : await call("fields.create", {
            teamId: props.teamId,
            recordType: props.recordType,
            name: name.trim(),
            type,
            ...(isSelect(type) ? { options: cleanOptions } : {}),
          })
      await props.onSaved(field, editing === undefined)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  const removedOptions = editing
    ? editing.options.filter((option) => !cleanOptions.some((kept) => kept.id === option.id))
    : []

  return (
    <Dialog
      title={
        editing ? `Edit ${editing.name}` : `New field on ${props.recordType === "contact" ? "contacts" : "companies"}`
      }
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || name.trim() === "" || (isSelect(type) && cleanOptions.length === 0)}
            onClick={() => void save()}
          >
            {editing ? "Save field" : "Add field"}
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="field-name">
          Name
        </label>
        <input
          id="field-name"
          className="inp"
          type="text"
          maxLength={60}
          placeholder="Plan, Renewal date, Account owner…"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {editing ? (
        <p className="hint sm-t">
          Type: {typeLabel(editing.type)}. A field's type can't change; add a new field instead.
        </p>
      ) : (
        <div className="fld">
          <label className="fl" htmlFor="field-type">
            Type
          </label>
          <div className="selwrap">
            <select
              id="field-type"
              className="sel plain"
              value={type}
              onChange={(event) => setType(event.target.value as CustomFieldType)}
            >
              {TYPES.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.label}
                </option>
              ))}
            </select>
            <span className="sel-chev">
              <ChevronDown />
            </span>
          </div>
          <p className="hint sm-t">{TYPES.find((entry) => entry.type === type)?.hint}</p>
        </div>
      )}
      {isSelect(editing?.type ?? type) ? (
        <fieldset className="fld">
          <legend>Options</legend>
          {options.map((option, index) => (
            <div key={option.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                className="inp"
                type="text"
                maxLength={60}
                aria-label={`Option ${index + 1}`}
                value={option.label}
                onChange={(event) => {
                  const next = [...options]
                  next[index] = { ...option, label: event.target.value }
                  setOptions(next)
                }}
              />
              <button
                className="ibtn"
                type="button"
                aria-label={`Remove option ${option.label || index + 1}`}
                onClick={() => setOptions(options.filter((other) => other.id !== option.id))}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          ))}
          <button
            className="linkish sm-t"
            type="button"
            onClick={() => setOptions([...options, { id: optionId("option"), label: "" }])}
          >
            <PlusIcon size={12} />
            Add option
          </button>
          {removedOptions.length > 0 ? (
            <p className="hint sm-t">
              Removing {removedOptions.map((option) => option.label).join(", ")} clears it from every record that has
              it.
            </p>
          ) : null}
        </fieldset>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
