import type { TeamId, UserId } from "@parley/domain"
import { useId } from "react"
import { personLabel, usePeople } from "../lib/people.ts"
import { initialsOfName } from "./record.tsx"
import { Avatar, PropertyRow, Select } from "./ui/index.ts"

/**
 * A record's owner (D123) as a property: "Contact owner" or "Company owner", chosen from the team's
 * members and service accounts, or no one. An owner who has since left still shows by name until
 * someone changes it.
 */
export function RecordOwnerField(props: {
  readonly teamId: TeamId
  readonly label: "Contact owner" | "Company owner"
  readonly ownerId: UserId | null
  readonly ownerName: string | null
  readonly disabled?: boolean
  readonly onChange: (owner: { readonly id: UserId; readonly name: string } | null) => void
}) {
  const id = useId()
  const people = usePeople(props.teamId).data ?? []
  const listed = props.ownerId === null || people.some((person) => person.userId === props.ownerId)
  return (
    <PropertyRow label={props.label} htmlFor={id}>
      <div className="flex min-w-0 items-center gap-2">
        {props.ownerName ? <Avatar>{initialsOfName(props.ownerName)}</Avatar> : null}
        <Select
          id={id}
          variant="inline"
          disabled={props.disabled}
          value={props.ownerId ?? ""}
          onChange={(event) => {
            const chosen = people.find((person) => person.userId === event.target.value)
            props.onChange(chosen ? { id: chosen.userId, name: chosen.name } : null)
          }}
        >
          <option value="">No one</option>
          {listed ? null : <option value={props.ownerId ?? ""}>{props.ownerName ?? "Someone who left"}</option>}
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>
              {personLabel(person)}
            </option>
          ))}
        </Select>
      </div>
    </PropertyRow>
  )
}

/** A record owner in a list cell: their initials and name, or nothing. */
export function RecordOwnerCell(props: { readonly name: string | null }) {
  if (!props.name) return <span className="text-subtle">—</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar>{initialsOfName(props.name)}</Avatar>
      <span className="truncate">{props.name}</span>
    </span>
  )
}
