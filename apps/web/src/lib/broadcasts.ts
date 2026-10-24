import type { Broadcast } from "@parley/domain"

export const BROADCAST_STATUS_LABELS: Readonly<Record<Broadcast["status"], string>> = {
  draft: "Draft",
  sending: "Sending",
  sent: "Sent",
  canceled: "Canceled",
}
