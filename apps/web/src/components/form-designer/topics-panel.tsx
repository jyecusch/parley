import type { FormContent, FormField, Segment, TeamId, Topic } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { call, messageOf } from "../../lib/client.ts"
import type { useTopics } from "../../lib/forms.ts"
import { CloseIcon, PlusIcon } from "../icons.tsx"
import { LoadFailed } from "../record.tsx"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu.tsx"
import {
  Button,
  Checkbox,
  ErrorText,
  Field,
  Fieldset,
  IconButton,
  Input,
  Option,
  Select,
  Skeleton,
  Textarea,
  TextButton,
} from "../ui/index.ts"
import { type ContentChange, consentFields, inputFields, MoveButtons } from "./shared.tsx"

export function TopicsPanel(props: {
  readonly teamId: TeamId
  readonly content: FormContent
  readonly topics: ReturnType<typeof useTopics>
  readonly onChange: ContentChange
}) {
  const { teamId } = props
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })
  // Until topics and segments are in, a box's topic or the chosen segment would read as missing.
  if (props.topics.isPending || segments.isPending) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        <Skeleton className="w-2/5" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="w-3/5" />
      </div>
    )
  }
  if (props.topics.isError || segments.isError) {
    return (
      <LoadFailed
        title="Topics didn't load"
        message={messageOf(props.topics.error ?? segments.error)}
        onRetry={() => {
          void props.topics.refetch()
          void segments.refetch()
        }}
      />
    )
  }
  return <TopicsEditor {...props} topics={props.topics.data} segments={segments.data} />
}

function TopicsEditor(props: {
  readonly teamId: TeamId
  readonly content: FormContent
  readonly topics: ReadonlyArray<Topic>
  readonly segments: ReadonlyArray<Segment>
  readonly onChange: ContentChange
}) {
  const { content, onChange, teamId } = props
  const queryClient = useQueryClient()
  const consents = consentFields(content)
  const fixed = props.segments.filter((segment) => segment.kind === "fixed")
  const [newTopic, setNewTopic] = useState("")
  const [error, setError] = useState<string>()
  const setConsents = (next: ReadonlyArray<FormField>) =>
    onChange((current) => ({ ...current, fields: [...inputFields(current), ...next] }))
  const used = new Set(consents.map((field) => (field.kind === "consent" ? (field.topicId as string) : "")))
  const free = props.topics.filter((topic) => !used.has(topic.id))
  const moveConsent = (from: number, to: number) => {
    if (to < 0 || to >= consents.length) return
    const next = [...consents]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    setConsents(next)
  }
  const add = (topic: Topic) =>
    setConsents([
      ...consents,
      { kind: "consent", topicId: topic.id, label: `Send me ${topic.name.toLowerCase()}.`, required: false },
    ])
  const create = async () => {
    const name = newTopic.trim()
    if (!name) return
    try {
      const topic = await call("topics.create", { teamId, name: name as never, mode: "opt-in" })
      await queryClient.invalidateQueries({ queryKey: ["topics", teamId] })
      setNewTopic("")
      setError(undefined)
      add(topic)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <Fieldset
        legend="Consent boxes"
        section
        info="Each box joins a topic when it's ticked, and starts unticked. Opt-in topics reach only people who joined them; opt-out topics reach everyone subscribed who hasn't left."
      >
        {consents.map((field, index) => {
          if (field.kind !== "consent") return null
          const topic = props.topics.find((entry) => entry.id === field.topicId)
          return (
            <div key={field.topicId} className="flex flex-col gap-2 rounded-lg bg-fill p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {topic?.name ?? "A deleted topic"}{" "}
                  <span className="text-subtle">· {topic?.mode === "opt-in" ? "opt-in" : "opt-out"}</span>
                </span>
                <MoveButtons
                  label={topic?.name ?? "this box"}
                  index={index}
                  count={consents.length}
                  onMove={(to) => moveConsent(index, to)}
                />
                <IconButton
                  size="xs"
                  label={`Remove ${topic?.name ?? "this box"}`}
                  onClick={() => setConsents(consents.filter((_, i) => i !== index))}
                >
                  <CloseIcon className="size-4" />
                </IconButton>
              </div>
              <Textarea
                aria-label={`Wording for ${topic?.name ?? "the topic"}`}
                rows={2}
                maxLength={300}
                value={field.label}
                onChange={(event) =>
                  setConsents(
                    consents.map((entry, i) => (i === index ? { ...field, label: event.target.value } : entry)),
                  )
                }
              />
              <Option>
                <Checkbox
                  checked={field.required}
                  onChange={(event) =>
                    setConsents(
                      consents.map((entry, i) => (i === index ? { ...field, required: event.target.checked } : entry)),
                    )
                  }
                />
                Required
              </Option>
            </div>
          )
        })}
        {free.length > 0 ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <TextButton className="self-start">
                  <PlusIcon className="size-3.5" />
                  Add consent box
                </TextButton>
              }
            />
            <DropdownMenuContent className="w-64">
              {free.map((topic) => (
                <DropdownMenuItem key={topic.id} onClick={() => add(topic)}>
                  <span className="truncate">{topic.name}</span>
                  <span className="ml-auto text-sm text-subtle">{topic.mode}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <div className="flex items-end gap-2">
          <Field label="New opt-in topic" htmlFor="new-topic" className="flex-1">
            <Input
              id="new-topic"
              maxLength={60}
              placeholder="Product updates"
              value={newTopic}
              onChange={(event) => setNewTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create()
              }}
            />
          </Field>
          <Button variant="secondary" size="lg" disabled={!newTopic.trim()} onClick={() => void create()}>
            Create and add
          </Button>
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Fieldset>
      <Field
        label="Add to a segment"
        htmlFor="form-segment"
        info="A fixed segment every confirmed submission's contact joins, such as a launch list. Dynamic segments pick their own contacts, so they aren't offered."
      >
        <Select
          id="form-segment"
          value={content.segmentId ?? ""}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              segmentId: (event.target.value || null) as FormContent["segmentId"],
            }))
          }
        >
          <option value="">No segment</option>
          {fixed.map((segment) => (
            <option key={segment.id} value={segment.id}>
              {segment.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
