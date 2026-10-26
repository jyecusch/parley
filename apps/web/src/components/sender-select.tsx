import type { Sender, SenderId, TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { call } from "../lib/client.ts"
import { FieldLabel, Hint, Select } from "./ui/index.ts"

/** The team's senders, shared by every picker so one change refreshes them all. */
export const useSenders = (teamId: TeamId) =>
  useQuery({ queryKey: ["senders", teamId], queryFn: () => call("senders.list", { teamId }) })

/** "Acme <hello@acme.com>" */
export const senderLabel = (sender: Pick<Sender, "name" | "address">) => `${sender.name} <${sender.address}>`

/** The sender an email goes out as: the one chosen, else (or if it's gone) the team's default (D162). */
export const senderFor = (senders: ReadonlyArray<Sender> | undefined, senderId: SenderId | null) =>
  senders?.find((sender) => sender.id === senderId) ?? senders?.find((sender) => sender.isDefault)

/**
 * Who a broadcast or a form's confirmation email is from (D162). Null means the team's default, so
 * a later change of default carries through.
 */
export function SenderSelect(props: {
  readonly teamId: TeamId
  readonly id: string
  readonly label: string
  readonly value: SenderId | null
  readonly disabled: boolean
  readonly onChange: (senderId: SenderId | null) => void
}) {
  const senders = useSenders(props.teamId)
  const fallback = senders.data?.find((sender) => sender.isDefault)
  const chosen = senderFor(senders.data, props.value)
  return (
    <div className="flex min-w-0 flex-col">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Select
        id={props.id}
        disabled={props.disabled}
        value={props.value ?? ""}
        onChange={(event) => props.onChange((event.target.value || null) as SenderId | null)}
      >
        <option value="">Default sender{fallback ? ` (${senderLabel(fallback)})` : ""}</option>
        {(senders.data ?? []).map((sender) => (
          <option key={sender.id} value={sender.id} disabled={!sender.ready && sender.id !== props.value}>
            {senderLabel(sender)}
            {sender.ready ? "" : ": domain not verified"}
          </option>
        ))}
      </Select>
      <Hint className="mt-1.5">
        {chosen ? (
          chosen.ready ? (
            <>Footer: {[chosen.legalName, chosen.postalAddress].join(" · ")}. </>
          ) : (
            <span className="text-warn">Can't send until its domain is verified. </span>
          )
        ) : (
          <span className="text-warn">Your team has no sender yet. </span>
        )}
        <Link className="text-muted underline" to="/t/$teamId/settings/email" params={{ teamId: props.teamId }}>
          Senders
        </Link>{" "}
        are set up in Settings.
      </Hint>
    </div>
  )
}
