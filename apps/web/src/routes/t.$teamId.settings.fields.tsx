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
import {
  Box,
  Button,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  IconButton,
  Input,
  Notice,
  SegmentedControl,
  Select,
  Table,
  Td,
  TextButton,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowActions } from "../components/ui/settings-extra.tsx"
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
          <Button variant="primary" size="sm" onClick={() => setDialog("new")}>
            New field
          </Button>
        ) : null
      }
    >
      <SegmentedControl
        name="record-type"
        label="Record type"
        options={[
          { value: "contact", label: "Contacts" },
          { value: "company", label: "Companies" },
        ]}
        value={recordType}
        onChange={setRecordType}
      />
      {canManage ? null : (
        <Notice icon={<InfoIcon />}>
          Only admins and owners can add or change fields. You can fill them in on any record.
        </Notice>
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
          icon={<DisplayIcon className="size-5" />}
          title={`No fields on ${recordType === "contact" ? "contacts" : "companies"} yet`}
        >
          {canManage
            ? "Add one for anything your team tracks that isn't built in."
            : "An admin can add fields for anything your team tracks that isn't built in."}
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-[34%]">
                  Name
                </Th>
                <Th scope="col" className="w-[18%]">
                  Type
                </Th>
                <Th scope="col">Options</Th>
                <Th scope="col" className="w-56">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((field, index) => (
                <Tr key={field.id}>
                  <Td className="font-medium">{field.name}</Td>
                  <Td className="text-subtle">{typeLabel(field.type)}</Td>
                  <Td className="text-subtle" title={field.options.map((option) => option.label).join(", ")}>
                    {isSelect(field.type) ? field.options.map((option) => option.label).join(", ") : "—"}
                  </Td>
                  <Td className="text-right">
                    {!canManage ? null : confirming === field.id ? (
                      <RowActions>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(undefined)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-solid"
                          aria-label={`Confirm: delete ${field.name}`}
                          onClick={() => void remove(field)}
                        >
                          Delete
                        </Button>
                      </RowActions>
                    ) : (
                      <RowActions>
                        <IconButton
                          size="xs"
                          label={`Move ${field.name} up`}
                          disabled={index === 0}
                          onClick={() => void move(field, -1)}
                        >
                          <ChevronUp className="size-4" />
                        </IconButton>
                        <IconButton
                          size="xs"
                          label={`Move ${field.name} down`}
                          disabled={index === shown.length - 1}
                          onClick={() => void move(field, 1)}
                        >
                          <ChevronDown className="size-4" />
                        </IconButton>
                        <Button size="sm" variant="ghost" onClick={() => setDialog(field)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={`Delete ${field.name}`}
                          onClick={() => setConfirming(field.id)}
                        >
                          Delete
                        </Button>
                      </RowActions>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || name.trim() === "" || (isSelect(type) && cleanOptions.length === 0)}
            onClick={() => void save()}
          >
            {editing ? "Save field" : "Add field"}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="field-name">
        <Input
          id="field-name"
          type="text"
          maxLength={60}
          placeholder="Plan, Renewal date, Account owner…"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {editing ? (
        <Hint>Type: {typeLabel(editing.type)}. A field's type can't change; add a new field instead.</Hint>
      ) : (
        <Field label="Type" htmlFor="field-type" hint={TYPES.find((entry) => entry.type === type)?.hint}>
          <Select id="field-type" value={type} onChange={(event) => setType(event.target.value as CustomFieldType)}>
            {TYPES.map((entry) => (
              <option key={entry.type} value={entry.type}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {isSelect(editing?.type ?? type) ? (
        <Fieldset legend="Options">
          {options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-1.5">
              <Input
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
              <IconButton
                label={`Remove option ${option.label || index + 1}`}
                onClick={() => setOptions(options.filter((other) => other.id !== option.id))}
              >
                <CloseIcon className="size-4" />
              </IconButton>
            </div>
          ))}
          <TextButton
            className="text-sm"
            onClick={() => setOptions([...options, { id: optionId("option"), label: "" }])}
          >
            <PlusIcon className="size-3.5" />
            Add option
          </TextButton>
          {removedOptions.length > 0 ? (
            <Hint>
              Removing {removedOptions.map((option) => option.label).join(", ")} clears it from every record that has
              it.
            </Hint>
          ) : null}
        </Fieldset>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
