import type { ActivityEntry, Note, NoteId, RecordType, TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"
import { AgentIcon, MoreIcon } from "./icons.tsx"
import { ActivityRow, initialsOfName } from "./record.tsx"

const team = getRouteApi("/t/$teamId")

type Entry = { readonly at: string; readonly activity: ActivityEntry } | { readonly at: string; readonly note: Note }

/**
 * A record's activity with its notes in among the changes, oldest first, and a box to add a note
 * (D63, D74). Notes are operations, so agents add them the same way.
 */
export function Timeline(props: {
  readonly teamId: TeamId
  readonly recordType: RecordType
  readonly recordId: string
  readonly activity: ReadonlyArray<ActivityEntry> | undefined
  readonly activityLoading: boolean
  readonly activityError: UserText | undefined
  readonly onError: (text: UserText) => void
}) {
  const { userId } = team.useRouteContext()
  const { team: current } = team.useLoaderData()
  const queryClient = useQueryClient()
  const key = ["notes", props.teamId, props.recordId]
  const notes = useQuery({
    queryKey: key,
    queryFn: () => call("notes.list", { teamId: props.teamId, recordType: props.recordType, recordId: props.recordId }),
  })
  const isAdmin = current.role !== "member"
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  const entries: ReadonlyArray<Entry> = [
    ...(props.activity ?? []).map((activity) => ({ at: activity.at, activity })),
    ...(notes.data ?? []).map((note) => ({ at: note.createdAt, note })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <section className="sec">
      <h3 className="sec-h sm-t">Activity</h3>
      {props.activityLoading || notes.isLoading ? (
        <div className="sk" style={{ width: "60%", margin: "8px 0" }} />
      ) : null}
      {props.activityError ? <p className="ferr sm-t">{props.activityError}</p> : null}
      {notes.isError ? <p className="ferr sm-t">{messageOf(notes.error)}</p> : null}
      {entries.map((entry, index) =>
        "note" in entry ? (
          <NoteRow
            key={entry.note.id}
            note={entry.note}
            first={index === 0}
            canEdit={entry.note.authorUserId === userId}
            canDelete={entry.note.authorUserId === userId || isAdmin}
            onSave={async (body) => {
              try {
                await call("notes.update", { teamId: props.teamId, noteId: entry.note.id as NoteId, body })
              } catch (failure) {
                props.onError(messageOf(failure))
              }
              await refresh()
            }}
            onDelete={async () => {
              try {
                await call("notes.delete", { teamId: props.teamId, noteId: entry.note.id as NoteId })
              } catch (failure) {
                props.onError(messageOf(failure))
              }
              await refresh()
            }}
          />
        ) : (
          <ActivityRow
            key={entry.activity.id}
            entry={entry.activity}
            recordType={props.recordType}
            first={index === 0}
          />
        ),
      )}
      <NoteComposer
        onAdd={async (body) => {
          await call("notes.create", {
            teamId: props.teamId,
            recordType: props.recordType,
            recordId: props.recordId,
            body,
          })
          await refresh()
        }}
      />
    </section>
  )
}

function NoteComposer(props: { readonly onAdd: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const add = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await props.onAdd(text)
      setBody("")
    } catch (failure) {
      // The draft stays, so nothing typed is lost (D48).
      setError(messageOf(failure))
    }
    setBusy(false)
  }
  return (
    <div className="composer">
      <label className="vh" htmlFor="note-body">
        Add a note
      </label>
      <textarea
        id="note-body"
        className="note-inp"
        placeholder="Add a note…"
        rows={body.includes("\n") ? 4 : 2}
        maxLength={10_000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            void add()
          }
          if (event.key === "Escape") event.stopPropagation()
        }}
      />
      {body.trim() ? (
        <div className="composer-f">
          <button className="btn primary sm" type="button" disabled={busy} onClick={() => void add()}>
            Add note <span className="kbd on-primary">⌘↵</span>
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="ferr sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function NoteRow(props: {
  readonly note: Note
  readonly first: boolean
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly onSave: (body: string) => Promise<void>
  readonly onDelete: () => Promise<void>
}) {
  const { note } = props
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const edited = note.updatedAt !== note.createdAt
  return (
    <div className={`act note ${props.first ? "first" : ""}`}>
      <span className="av" aria-hidden="true">
        {initialsOfName(note.authorName)}
        {note.via ? (
          <span className="agent">
            <AgentIcon />
          </span>
        ) : null}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="act-l">
          <b>{note.authorName}</b>
          {note.via ? <span className="via"> via {note.via}</span> : null} added a note
          {edited ? <span className="src"> (edited)</span> : null}
        </div>
        {editing ? (
          <div className="composer" style={{ marginTop: 4 }}>
            <textarea
              className="note-inp"
              aria-label="Edit note"
              rows={4}
              maxLength={10_000}
              // biome-ignore lint/a11y/noAutofocus: the person just asked to edit this note
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault()
                  setEditing(false)
                  if (draft.trim() && draft.trim() !== note.body) void props.onSave(draft.trim())
                }
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setEditing(false)
                  setDraft(note.body)
                }
              }}
            />
            <div className="composer-f">
              <button
                className="btn primary sm"
                type="button"
                onClick={() => {
                  setEditing(false)
                  if (draft.trim() && draft.trim() !== note.body) void props.onSave(draft.trim())
                }}
              >
                Save
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="note-body">{note.body}</p>
        )}
      </div>
      <span className="when sm-t" style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
        <span title={absolute(note.createdAt)}>{relative(note.createdAt)}</span>
        {props.canEdit || props.canDelete ? (
          <span style={{ position: "relative" }}>
            <button
              className="ibtn xs"
              type="button"
              aria-label="Note actions"
              aria-expanded={menu}
              onClick={() => setMenu((open) => !open)}
            >
              <MoreIcon size={12} />
            </button>
            {menu ? (
              <div className="menu" style={{ right: 0, top: 24 }}>
                {props.canEdit ? (
                  <button
                    className="menu-i"
                    type="button"
                    onClick={() => {
                      setMenu(false)
                      setDraft(note.body)
                      setEditing(true)
                    }}
                  >
                    Edit note
                  </button>
                ) : null}
                {props.canDelete ? (
                  <button
                    className="menu-i"
                    type="button"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      setMenu(false)
                      void props.onDelete()
                    }}
                  >
                    Delete note
                  </button>
                ) : null}
              </div>
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  )
}
