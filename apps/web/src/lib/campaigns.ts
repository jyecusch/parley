import type { Campaign } from "@parley/domain"

export const CAMPAIGN_STATUS_LABELS: Readonly<Record<Campaign["status"], string>> = {
  draft: "Draft",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
}
