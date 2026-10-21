import { createFileRoute, redirect } from "@tanstack/react-router"

/** The old address of the broadcasts list, from before D140 renamed campaigns to broadcasts. */
export const Route = createFileRoute("/t/$teamId/campaigns/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$teamId/broadcasts", params })
  },
})
