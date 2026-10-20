import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { InfoIcon } from "../components/icons.tsx"
import { SettingsPage, useToast } from "../components/settings.tsx"
import { Button, Checkbox, Field, Input, Notice, Option } from "../components/ui/index.ts"
import { SettingsPanel } from "../components/ui/settings-extra.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/general")({ component: General })

const team = getRouteApi("/t/$teamId")

function General() {
  const { team: current } = team.useLoaderData()
  const router = useRouter()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("team:manage")
  const [toast, showToast] = useToast()
  const [name, setName] = useState(current.name)
  const [busy, setBusy] = useState(false)

  const save = async (changes: { name?: string; gravatar?: boolean }) => {
    setBusy(true)
    try {
      await call("teams.update", { teamId, ...changes })
      // The team's name and settings live in the team layout's data, so it reloads.
      await router.invalidate()
      showToast("Saved.")
    } catch (failure) {
      showToast(messageOf(failure))
    }
    setBusy(false)
  }

  return (
    <SettingsPage title="General" intro={`The basics of ${current.name}.`}>
      {canManage ? null : <Notice icon={<InfoIcon />}>Only owners can change these.</Notice>}
      <SettingsPanel>
        <Field label="Team name" htmlFor="team-name">
          <div className="flex gap-1.5">
            <Input
              id="team-name"
              type="text"
              maxLength={80}
              disabled={!canManage}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim() && name.trim() !== current.name)
                  void save({ name: name.trim() })
              }}
            />
            {canManage ? (
              <Button
                size="lg"
                disabled={busy || !name.trim() || name.trim() === current.name}
                onClick={() => void save({ name: name.trim() })}
              >
                Save
              </Button>
            ) : null}
          </div>
        </Field>
      </SettingsPanel>
      <SettingsPanel>
        <Option className="items-start">
          <Checkbox
            className="mt-1"
            disabled={!canManage || busy}
            checked={current.gravatar}
            onChange={(event) => void save({ gravatar: event.target.checked })}
          />
          <span>
            <b className="font-medium text-fg">Show Gravatar avatars</b>
            <span className="mt-0.5 block text-sm text-subtle">
              Contacts without an uploaded avatar show the Gravatar for their primary email. Turning this on sends a
              hash of each email address to Gravatar when someone views it.
            </span>
          </span>
        </Option>
      </SettingsPanel>
      {toast}
    </SettingsPage>
  )
}
