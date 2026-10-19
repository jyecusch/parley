import type { TeamId } from "@parley/domain"
import { createFileRoute, Outlet, redirect, useMatchRoute } from "@tanstack/react-router"
import { SettingsShell } from "../components/settings.tsx"
import { AppShell } from "../components/shell.tsx"
import { getSession } from "../lib/auth.ts"
import { call } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: "/sign-in" })
    return { userName: session.user.name }
  },
  loader: async ({ params }) => {
    const teams = await call("teams.list", {})
    const team = teams.find((candidate) => candidate.id === (params.teamId as TeamId))
    if (!team) throw redirect({ to: "/" })
    return { team, teams }
  },
  component: TeamLayout,
})

function TeamLayout() {
  const { team, teams } = Route.useLoaderData()
  const { userName } = Route.useRouteContext()
  const inSettings = useMatchRoute()({ to: "/t/$teamId/settings", fuzzy: true })
  if (inSettings) {
    return (
      <SettingsShell team={team}>
        <Outlet />
      </SettingsShell>
    )
  }
  return (
    <AppShell team={team} teams={teams} userName={userName}>
      <Outlet />
    </AppShell>
  )
}
