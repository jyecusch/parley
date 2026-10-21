import type { ContactId, SegmentId, Selection, TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { SegmentIcon } from "./icons.tsx"
import { ItemTile } from "./ui/email.tsx"
import { Box, Button, Dialog, ErrorText, Field, Input, PopoverItem } from "./ui/index.ts"

/** Adds selected contacts to a fixed segment, or to a new one (D23). */
export function AddToSegmentDialog(props: {
  readonly teamId: TeamId
  /** The selection (D137), as calls of up to 1,000 ids or one "all matching". */
  readonly selections: ReadonlyArray<Selection>
  readonly count: number
  readonly onDone: (text: string) => void
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const segments = useQuery({
    queryKey: ["segments", props.teamId],
    queryFn: () => call("segments.list", { teamId: props.teamId }),
  })
  const fixed = (segments.data ?? []).filter((segment) => segment.kind === "fixed")
  const [choice, setChoice] = useState<SegmentId | "new">()
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const count = props.count
  const ready = choice === "new" ? name.trim() !== "" : choice !== undefined

  const apply = async () => {
    setBusy(true)
    try {
      const segment =
        choice === "new"
          ? await call("segments.create", { teamId: props.teamId, name: name.trim(), kind: "fixed" })
          : fixed.find((entry) => entry.id === choice)
      if (!segment) return
      for (const selection of props.selections) {
        await call("segments.addContacts", {
          teamId: props.teamId,
          segmentId: segment.id,
          ...("ids" in selection
            ? { contactIds: selection.ids.map((id) => id as ContactId) }
            : { matching: selection.matching }),
        })
      }
      await queryClient.invalidateQueries({ queryKey: ["segments", props.teamId] })
      props.onDone(`${count.toLocaleString()} ${count === 1 ? "contact" : "contacts"} added to ${segment.name}.`)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Add ${count.toLocaleString()} ${count === 1 ? "contact" : "contacts"} to a segment`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void apply()}>
            Add to segment
          </Button>
        </>
      }
    >
      <Field
        label="Fixed segment"
        hint="Dynamic segments follow their filter, so contacts can't be added to them by hand."
      >
        <Box className="max-h-64 overflow-auto p-1">
          {fixed.map((segment) => (
            <PopoverItem
              key={segment.id}
              active={choice === segment.id}
              trailing={<span className="text-sm">{segment.contactCount}</span>}
              onClick={() => setChoice(segment.id)}
            >
              <ItemTile icon={<SegmentIcon className="size-4" />} />
              <span>{segment.name}</span>
            </PopoverItem>
          ))}
          <PopoverItem active={choice === "new"} onClick={() => setChoice("new")}>
            <ItemTile icon="+" />
            <span>New fixed segment</span>
          </PopoverItem>
        </Box>
      </Field>
      {choice === "new" ? (
        <Field label="Name" htmlFor="new-segment-name">
          <Input
            id="new-segment-name"
            maxLength={80}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}
