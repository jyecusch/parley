import { type ApiKey, type CreatedApiKey, type Permission, ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { KeyIcon, WarnIcon } from "../components/icons.tsx"
import {
  CopyField,
  Dialog,
  Empty,
  LoadFailed,
  LoadingRows,
  RevokeButton,
  SCOPE_LABELS,
  ScopeChips,
  SettingsPage,
  useToast,
  When,
} from "../components/settings.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/api-keys")({ component: ApiKeys })

const team = getRouteApi("/t/$teamId")

/** What the dialog offers (D99). `records:read` is always on (D98). */
const OFFERED: ReadonlyArray<Permission> = ["records:read", "records:write", "records:delete", "fields:manage"]
const EXPIRIES = [undefined, 30, 90, 365] as const
type Expiry = (typeof EXPIRIES)[number]

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })

const expiryLine = (key: ApiKey) =>
  key.revoked ? "Revoked" : key.expiresAt ? `Expires ${dateOnly(key.expiresAt)}` : "Never expires"

function ApiKeys() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const [dialog, setDialog] = useState<"new" | CreatedApiKey>()
  const key = ["api-keys", teamId]
  const keys = useQuery({ queryKey: key, queryFn: () => call("apiKeys.list", { teamId }) })

  const revoke = async (apiKey: ApiKey) => {
    try {
      const revoked = await call("apiKeys.revoke", { teamId, apiKeyId: apiKey.id })
      queryClient.setQueryData<ReadonlyArray<ApiKey>>(key, (rows) =>
        rows?.map((row) => (row.id === revoked.id ? revoked : row)),
      )
      showToast(`${apiKey.name} is revoked. Requests with it are refused from now on.`)
    } catch (failure) {
      showToast(messageOf(failure))
    }
  }

  return (
    <SettingsPage
      title="API keys"
      intro="For the HTTP API, and for agents that can't sign in through the browser, like CI jobs. A key acts as you and never does more than your role allows, limited further by its scopes."
      action={
        <button className="btn primary sm" type="button" onClick={() => setDialog("new")}>
          New API key
        </button>
      }
    >
      {keys.isPending ? (
        <LoadingRows />
      ) : keys.isError ? (
        <LoadFailed title="API keys didn't load" message={messageOf(keys.error)} onRetry={() => void keys.refetch()} />
      ) : keys.data.length === 0 ? (
        <Empty icon={<KeyIcon />} title="No API keys yet">
          Create one for a script or an agent that can't sign in through the browser. It's shown once, when you create
          it.
        </Empty>
      ) : (
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col" style={{ width: "26%" }}>
                  Name
                </th>
                <th scope="col" style={{ width: "18%" }}>
                  Key
                </th>
                <th scope="col" style={{ width: "20%" }}>
                  Scopes
                </th>
                <th scope="col" style={{ width: 96 }}>
                  Created
                </th>
                <th scope="col" style={{ width: 96 }}>
                  Last used
                </th>
                <th scope="col" style={{ width: 150 }}>
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.data.map((apiKey) => (
                <tr key={apiKey.id} className={apiKey.revoked ? "revoked" : ""}>
                  <td>
                    <div className="who">
                      <span className="stack">
                        <span className="n">{apiKey.name}</span>
                        <span className="s sm-t">{expiryLine(apiKey)}</span>
                      </span>
                    </div>
                  </td>
                  <td className="mono">{apiKey.start ? `${apiKey.start}…` : "—"}</td>
                  <td>
                    <ScopeChips scopes={apiKey.scopes} />
                  </td>
                  <td>
                    <When at={apiKey.createdAt} />
                  </td>
                  <td>
                    <When at={apiKey.lastUsedAt} />
                  </td>
                  <td className="c-act">
                    {apiKey.revoked ? (
                      <span className="rtag" title="Requests with this key are refused">
                        Revoked
                      </span>
                    ) : (
                      <RevokeButton name={apiKey.name} onRevoke={() => revoke(apiKey)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog === "new" ? (
        <NewApiKey
          teamId={teamId}
          rolePermissions={ROLE_PERMISSIONS[current.role]}
          onClose={() => setDialog(undefined)}
          onCreated={(created) => {
            queryClient.setQueryData<ReadonlyArray<ApiKey>>(key, (rows) => [created.apiKey, ...(rows ?? [])])
            setDialog(created)
          }}
        />
      ) : dialog ? (
        <ApiKeyCreated teamId={teamId} created={dialog} onClose={() => setDialog(undefined)} />
      ) : null}
      {toast}
    </SettingsPage>
  )
}

function NewApiKey(props: {
  readonly teamId: TeamId
  readonly rolePermissions: ReadonlySet<Permission>
  readonly onClose: () => void
  readonly onCreated: (created: CreatedApiKey) => void
}) {
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<ReadonlySet<Permission>>(new Set(["records:read"]))
  const [expiry, setExpiry] = useState<Expiry>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()

  const toggle = (scope: Permission) =>
    setScopes((current) => {
      const next = new Set(current)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })

  const create = async () => {
    setBusy(true)
    setError(undefined)
    try {
      props.onCreated(
        await call("apiKeys.create", {
          teamId: props.teamId,
          name: name.trim(),
          scopes: OFFERED.filter((scope) => scopes.has(scope)),
          ...(expiry ? { expiresInDays: expiry } : {}),
        }),
      )
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="New API key"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || name.trim() === ""}
            onClick={() => void create()}
          >
            Create API key
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="key-name">
          Name
        </label>
        <input
          className="inp"
          id="key-name"
          type="text"
          placeholder="What it's for"
          maxLength={60}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim() !== "") void create()
          }}
        />
        <p className="hint sm-t">Shown in record activity, like “Jane Doe via Nightly CRM sync”.</p>
      </div>
      <fieldset className="fld">
        <legend>Scopes</legend>
        <div className="checks">
          {OFFERED.map((scope) => {
            const locked = scope === "records:read"
            const allowed = props.rolePermissions.has(scope)
            return (
              <label key={scope} className={`chk ${allowed ? "" : "off"}`}>
                <input
                  className={`cb ${locked ? "locked" : ""}`}
                  type="checkbox"
                  checked={allowed && scopes.has(scope)}
                  disabled={locked || !allowed}
                  onChange={() => toggle(scope)}
                />
                <span className="mono">{scope}</span>
                <span className="d">
                  {SCOPE_LABELS[scope]}
                  {locked ? <span className="why"> · Always on</span> : null}
                  {allowed ? null : <span className="why"> · Your role can't grant this</span>}
                </span>
              </label>
            )
          })}
        </div>
        <p className="hint sm-t" style={{ marginTop: 6 }}>
          A key never does more than your role allows. Write and delete are off unless you turn them on.
        </p>
      </fieldset>
      <fieldset className="fld">
        <legend>Expiry</legend>
        <div className="seg">
          {EXPIRIES.map((days) => (
            <label key={days ?? "never"} className={expiry === days ? "on" : ""}>
              <input type="radio" name="key-expiry" checked={expiry === days} onChange={() => setExpiry(days)} />
              {days ? `${days} days` : "Never"}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

function ApiKeyCreated(props: {
  readonly teamId: TeamId
  readonly created: CreatedApiKey
  readonly onClose: () => void
}) {
  const { apiKey, secret } = props.created
  const curl = `curl ${window.location.origin}/api/v1/teams/${props.teamId}/contacts \\\n  -H "x-api-key: ${secret}"`
  return (
    <Dialog
      title="API key created"
      footer={
        <button className="btn primary" type="button" onClick={props.onClose}>
          Done
        </button>
      }
    >
      <div className="warn" role="note">
        <span className="ic">
          <WarnIcon />
        </span>
        <span>This is the only time you'll see this key. Store it somewhere safe.</span>
      </div>
      <div className="fld">
        <span className="fl">{apiKey.name}</span>
        <CopyField value={secret} label="API key" />
        <p className="hint sm-t">
          Scopes: {apiKey.scopes.join(", ")} ·{" "}
          {apiKey.expiresAt ? `Expires ${dateOnly(apiKey.expiresAt)}` : "Never expires"}
        </p>
      </div>
      <div className="fld">
        <span className="fl">Try it</span>
        <CopyField value={curl} label="example request" code />
      </div>
    </Dialog>
  )
}
