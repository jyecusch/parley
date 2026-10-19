import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/t/$teamId/settings/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/t/$teamId/settings/connections", params })
  },
})
