import { createFileRoute, redirect } from "@tanstack/react-router"
import { getSession } from "../lib/auth.ts"
import { call } from "../lib/client.ts"

/** Sends you where you belong: sign in, create a first team, or your first team's contacts. */
export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    if (!(await getSession())) throw redirect({ to: "/sign-in" })
    const [first] = await call("teams.list", {})
    if (!first) throw redirect({ to: "/new-team" })
    throw redirect({ to: "/t/$teamId/contacts", params: { teamId: first.id } })
  },
})
