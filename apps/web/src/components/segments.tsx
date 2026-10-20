import type { ContactId, SegmentId, TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { SegmentIcon } from "./icons.tsx"
import { Dialog } from "./settings.tsx"

/** Adds selected contacts to a fixed segment, or to a new one (D23). */
export function AddToSegmentDialog(props: {
  readonly teamId: TeamId
  readonly contactIds: ReadonlyArray<ContactId>
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
  const count = props.contactIds.length
  const ready = choice === "new" ? name.trim() !== "" : choice !== undefined

  const apply = async () => {
    setBusy(true)
    try {
      const segment =
        choice === "new"
          ? await call("segments.create", { teamId: props.teamId, name: name.trim(), kind: "fixed" })
          : fixed.find((entry) => entry.id === choice)
      if (!segment) return
      // The operation takes up to 1,000 at a time.
      for (let start = 0; start < props.contactIds.length; start += 1000) {
        await call("segments.addContacts", {
          teamId: props.teamId,
          segmentId: segment.id,
          contactIds: props.contactIds.slice(start, start + 1000),
        })
      }
      await queryClient.invalidateQueries({ queryKey: ["segments", props.teamId] })
      props.onDone(`${count} ${count === 1 ? "contact" : "contacts"} added to ${segment.name}.`)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`Add ${count} ${count === 1 ? "contact" : "contacts"} to a segment`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={!ready || busy} onClick={() => void apply()}>
            Add to segment
          </button>
        </>
      }
    >
      <div className="fld">
        <span className="fl">Fixed segment</span>
        <div className="box" style={{ maxHeight: 220, overflow: "auto", padding: 4 }}>
          {fixed.map((segment) => (
            <button
              key={segment.id}
              className={`pop-i ${choice === segment.id ? "on" : ""}`}
              type="button"
              onClick={() => setChoice(segment.id)}
            >
              <span className="tile" aria-hidden="true">
                <SegmentIcon className="size-3.5" />
              </span>
              <span>{segment.name}</span>
              <span className="s sm-t">{segment.contactCount}</span>
            </button>
          ))}
          <button className={`pop-i ${choice === "new" ? "on" : ""}`} type="button" onClick={() => setChoice("new")}>
            <span className="tile" aria-hidden="true">
              +
            </span>
            <span>New fixed segment</span>
          </button>
        </div>
        <p className="hint sm-t">Dynamic segments follow their filter, so contacts can't be added to them by hand.</p>
      </div>
      {choice === "new" ? (
        <div className="fld">
          <label className="fl" htmlFor="new-segment-name">
            Name
          </label>
          <input
            id="new-segment-name"
            className="inp"
            maxLength={80}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      ) : null}
      {error ? (
        <p className="err sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
