import { createFileRoute, redirect } from "@tanstack/react-router"

/** The old address of a broadcast, from before D140 renamed campaigns to broadcasts. */
export const Route = createFileRoute("/t/$teamId/campaigns/$campaignId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/t/$teamId/broadcasts/$broadcastId",
      params: { teamId: params.teamId, broadcastId: params.campaignId },
    })
  },
})
