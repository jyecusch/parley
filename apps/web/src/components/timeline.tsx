import type { ActivityEntry, ContactId, Note, NoteId, RecordType, TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { call, messageOf } from "../lib/client.ts"
import { refreshRecords } from "../lib/records.ts"
import { MoreIcon } from "./icons.tsx"
import { ActivityRow, TimelineRow } from "./record.tsx"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx"
import { Button, ErrorText, IconButton, Kbd, Section, SectionHeader, Skeleton, Textarea } from "./ui/index.ts"

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

  /** Writes a value a form submission kept (D145) to the contact, then reloads it and its activity. */
  const applyKept = async (kept: ActivityEntry["kept"][number]) => {
    const contactId = props.recordId as ContactId
    try {
      if (kept.field.startsWith("custom:")) {
        await call("contacts.update", {
          teamId: props.teamId,
          contactId,
          custom: { [kept.field.slice("custom:".length)]: kept.value as never },
        })
      } else {
        await call("contacts.update", { teamId: props.teamId, contactId, [kept.field]: kept.value } as never)
      }
    } catch (failure) {
      props.onError(messageOf(failure))
      throw failure
    }
    await Promise.all([
      refreshRecords(queryClient, "contacts", props.teamId),
      queryClient.invalidateQueries({ queryKey: ["contact-activity", props.teamId] }),
    ])
  }

  const entries: ReadonlyArray<Entry> = [
    ...(props.activity ?? []).map((activity) => ({ at: activity.at, activity })),
    ...(notes.data ?? []).map((note) => ({ at: note.createdAt, note })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <Section>
      <SectionHeader>Activity</SectionHeader>
      {props.activityLoading || notes.isLoading ? <Skeleton className="my-2 w-3/5" /> : null}
      {props.activityError ? <ErrorText className="my-1">{props.activityError}</ErrorText> : null}
      {notes.isError ? <ErrorText className="my-1">{messageOf(notes.error)}</ErrorText> : null}
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
            onApplyKept={props.recordType === "contact" ? applyKept : undefined}
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
    </Section>
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
    <div className="mt-2 flex flex-col gap-1.5">
      <label className="sr-only" htmlFor="note-body">
        Add a note
      </label>
      <Textarea
        id="note-body"
        className="min-h-12"
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
        <div className="flex gap-1.5">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void add()}>
            Add note <Kbd onPrimary>⌘↵</Kbd>
          </Button>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const edited = note.updatedAt !== note.createdAt
  const save = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== note.body) void props.onSave(draft.trim())
  }
  return (
    <TimelineRow
      actorName={note.authorName}
      via={note.via}
      first={props.first}
      at={note.createdAt}
      body={
        editing ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <Textarea
              className="min-h-12"
              aria-label="Edit note"
              rows={4}
              maxLength={10_000}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault()
                  save()
                }
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setEditing(false)
                  setDraft(note.body)
                }
              }}
            />
            <div className="flex gap-1.5">
              <Button variant="primary" size="sm" onClick={save}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="m-0 mt-1 rounded-md bg-fill px-3 py-2 leading-6 whitespace-pre-wrap text-fg wrap-anywhere">
            {note.body}
          </p>
        )
      }
      aside={
        props.canEdit || props.canDelete ? (
          <span className="relative">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <IconButton label="Note actions" size="xs">
                    <MoreIcon className="size-3.5" />
                  </IconButton>
                }
              />
              {/* Editing focuses the note's text box, so focus doesn't go back to this button. */}
              <DropdownMenuContent align="end" finalFocus={false}>
                {props.canEdit ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setDraft(note.body)
                      setEditing(true)
                    }}
                  >
                    Edit note
                  </DropdownMenuItem>
                ) : null}
                {props.canDelete ? (
                  <DropdownMenuItem variant="destructive" onClick={() => void props.onDelete()}>
                    Delete note
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null
      }
    >
      added a note
      {edited ? <span className="text-subtle"> (edited)</span> : null}
    </TimelineRow>
  )
}
