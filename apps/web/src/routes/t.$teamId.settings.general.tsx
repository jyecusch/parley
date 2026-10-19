import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { InfoIcon } from "../components/icons.tsx"
import { SettingsPage, useToast } from "../components/settings.tsx"
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
      {canManage ? null : (
        <div className="notice">
          <span className="ic">
            <InfoIcon />
          </span>
          <span>Only owners can change these.</span>
        </div>
      )}
      <section className="box urlcard">
        <div className="fld">
          <label className="fl" htmlFor="team-name">
            Team name
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              id="team-name"
              className="inp"
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
              <button
                className="btn"
                type="button"
                disabled={busy || !name.trim() || name.trim() === current.name}
                onClick={() => void save({ name: name.trim() })}
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      </section>
      <section className="box urlcard">
        <label className="opt" style={{ alignItems: "flex-start", gap: 10 }}>
          <input
            className="cb shown"
            type="checkbox"
            style={{ marginTop: 2 }}
            disabled={!canManage || busy}
            checked={current.gravatar}
            onChange={(event) => void save({ gravatar: event.target.checked })}
          />
          <span>
            <b style={{ fontWeight: 470, color: "var(--fg)" }}>Show Gravatar pictures</b>
            <span className="hint sm-t" style={{ display: "block", marginTop: 2 }}>
              Contacts without a picture show the Gravatar for their primary email. Turning this on sends a hash of each
              email address to Gravatar when someone views it.
            </span>
          </span>
        </label>
      </section>
      {toast}
    </SettingsPage>
  )
}
