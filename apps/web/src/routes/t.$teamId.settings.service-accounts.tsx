import { ROLE_PERMISSIONS, type ServiceAccount, type TeamId } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { InfoIcon, MoreIcon, ServiceAccountIcon } from "../components/icons.tsx"
import {
  Dialog,
  Empty,
  initialsOf,
  LoadFailed,
  LoadingRows,
  SettingsPage,
  useToast,
  When,
} from "../components/settings.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/service-accounts")({ component: ServiceAccounts })

const team = getRouteApi("/t/$teamId")

const ROLES = [
  { role: "member", label: "Member", description: "Works with contacts and companies." },
  { role: "admin", label: "Admin", description: "Also manages custom fields, members and service accounts." },
] as const

const roleLabel = (role: ServiceAccount["role"]) => role[0]?.toUpperCase() + role.slice(1)

function ServiceAccounts() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("service-accounts:manage")
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const [creating, setCreating] = useState(false)
  const key = ["service-accounts", teamId]
  const serviceAccounts = useQuery({ queryKey: key, queryFn: () => call("serviceAccounts.list", { teamId }) })

  return (
    <SettingsPage
      title="Service accounts"
      intro={`Members of ${current.name} that aren't people. Connect an agent as a service account and its changes show up as that account, not as you.`}
      action={
        canManage ? (
          <button className="btn primary sm" type="button" onClick={() => setCreating(true)}>
            New service account
          </button>
        ) : null
      }
    >
      {canManage ? null : (
        <div className="notice">
          <span className="ic">
            <InfoIcon />
          </span>
          <span>
            Only admins and owners can create service accounts. You can still connect an agent as one of these when you
            approve it.
          </span>
        </div>
      )}
      {serviceAccounts.isPending ? (
        <LoadingRows />
      ) : serviceAccounts.isError ? (
        <LoadFailed
          title="Service accounts didn't load"
          message={messageOf(serviceAccounts.error)}
          onRetry={() => void serviceAccounts.refetch()}
        />
      ) : serviceAccounts.data.length === 0 ? (
        <Empty icon={<ServiceAccountIcon />} title="No service accounts yet">
          {canManage
            ? "Create one for an agent whose changes shouldn't show up as yours, like a support bot or a nightly import."
            : "An admin can create one for an agent whose changes shouldn't show up as anyone's own."}
        </Empty>
      ) : (
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col" style={{ width: "32%" }}>
                  Name
                </th>
                <th scope="col" style={{ width: "14%" }}>
                  Role
                </th>
                <th scope="col" style={{ width: "24%" }}>
                  Created by
                </th>
                <th scope="col" style={{ width: 120 }}>
                  Connections
                </th>
                <th scope="col" style={{ width: 96 }}>
                  Created
                </th>
                {canManage ? (
                  <th scope="col" style={{ width: 56 }}>
                    <span className="vh">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {serviceAccounts.data.map((serviceAccount) => (
                <tr key={serviceAccount.id}>
                  <td>
                    <div className="who">
                      <span className="av md bot" aria-hidden="true">
                        {initialsOf(serviceAccount.name)}
                      </span>
                      <span className="stack">
                        <span className="n">{serviceAccount.name}</span>
                      </span>
                    </div>
                  </td>
                  <td style={{ color: "var(--fg-muted)" }}>{roleLabel(serviceAccount.role)}</td>
                  <td>
                    {serviceAccount.createdBy ? (
                      <span className="as">
                        <span className="av" aria-hidden="true">
                          {initialsOf(serviceAccount.createdBy.name)}
                        </span>
                        <span className="lbl">{serviceAccount.createdBy.name}</span>
                      </span>
                    ) : (
                      <span className="c-muted">—</span>
                    )}
                  </td>
                  <td className={serviceAccount.connectionCount === 0 ? "c-muted" : ""}>
                    {serviceAccount.connectionCount === 0
                      ? "None"
                      : `${serviceAccount.connectionCount} connection${serviceAccount.connectionCount === 1 ? "" : "s"}`}
                  </td>
                  <td>
                    <When at={serviceAccount.createdAt} />
                  </td>
                  {canManage ? (
                    <td className="c-act">
                      <ServiceAccountMenu
                        serviceAccount={serviceAccount}
                        teamId={teamId}
                        onDone={async (text) => {
                          if (text) showToast(text)
                          await queryClient.invalidateQueries({ queryKey: key })
                        }}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <NewServiceAccount
          teamId={teamId}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            queryClient.setQueryData<ReadonlyArray<ServiceAccount>>(key, (rows) =>
              [...(rows ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
            )
            setCreating(false)
            showToast(`${created.name} is created. Connect an agent as it when you approve the agent.`)
          }}
        />
      ) : null}
      {toast}
    </SettingsPage>
  )
}

function NewServiceAccount(props: {
  readonly teamId: TeamId
  readonly onClose: () => void
  readonly onCreated: (created: ServiceAccount) => void
}) {
  const [name, setName] = useState("")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()

  const create = async () => {
    setBusy(true)
    setError(undefined)
    try {
      props.onCreated(await call("serviceAccounts.create", { teamId: props.teamId, name: name.trim(), role }))
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="New service account"
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
            Create service account
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="sa-name">
          Name
        </label>
        <input
          className="inp"
          id="sa-name"
          type="text"
          placeholder="e.g. Support Bot"
          maxLength={60}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim() !== "") void create()
          }}
        />
        <p className="hint sm-t">Changes made through it show as this name in record activity.</p>
      </div>
      <fieldset className="fld">
        <legend>Role</legend>
        <div className="radios">
          {ROLES.map((option) => (
            <label key={option.role} className={`ropt ${role === option.role ? "on" : ""}`}>
              <input
                className="rd"
                type="radio"
                name="sa-role"
                checked={role === option.role}
                onChange={() => setRole(option.role)}
              />
              <span className="t">
                <span className="n">{option.label}</span>
                <span className="d sm-t">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="hint sm-t" style={{ marginTop: 6 }}>
          An agent acting as it gets the lower of this role and the role of whoever connects it.
        </p>
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/** Rename, change role or delete a service account (D101). */
function ServiceAccountMenu(props: {
  readonly serviceAccount: ServiceAccount
  readonly teamId: TeamId
  readonly onDone: (text: string | undefined) => Promise<void>
}) {
  const { serviceAccount, teamId } = props
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"rename" | "delete">()
  const [name, setName] = useState(serviceAccount.name)
  const [error, setError] = useState<UserText>()

  const act = async (action: () => Promise<unknown>, text: string) => {
    setError(undefined)
    try {
      await action()
      setMode(undefined)
      await props.onDone(text)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  return (
    <span style={{ position: "relative" }}>
      <button
        className="ibtn"
        type="button"
        aria-label={`More actions for ${serviceAccount.name}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="menu" style={{ right: 0, top: 30 }}>
          <button
            className="menu-i"
            type="button"
            onClick={() => {
              setOpen(false)
              setName(serviceAccount.name)
              setMode("rename")
            }}
          >
            Rename
          </button>
          <button
            className="menu-i"
            type="button"
            onClick={() => {
              setOpen(false)
              const role = serviceAccount.role === "admin" ? "member" : "admin"
              void act(
                () => call("serviceAccounts.update", { teamId, serviceAccountId: serviceAccount.id, role }),
                `${serviceAccount.name} is now ${role === "admin" ? "an admin" : "a member"}.`,
              )
            }}
          >
            {serviceAccount.role === "admin" ? "Make member" : "Make admin"}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-i"
            type="button"
            style={{ color: "var(--danger)" }}
            onClick={() => {
              setOpen(false)
              setMode("delete")
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
      {mode === "rename" ? (
        <Dialog
          title={`Rename ${serviceAccount.name}`}
          onClose={() => setMode(undefined)}
          footer={
            <>
              <button className="btn ghost" type="button" onClick={() => setMode(undefined)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={!name.trim() || name.trim() === serviceAccount.name}
                onClick={() =>
                  void act(
                    () =>
                      call("serviceAccounts.update", {
                        teamId,
                        serviceAccountId: serviceAccount.id,
                        name: name.trim(),
                      }),
                    `Renamed to ${name.trim()}.`,
                  )
                }
              >
                Rename
              </button>
            </>
          }
        >
          <div className="fld">
            <label className="fl" htmlFor="sa-rename">
              Name
            </label>
            <input
              id="sa-rename"
              className="inp"
              type="text"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="hint sm-t">Past activity keeps the name it had at the time.</p>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
      {mode === "delete" ? (
        <Dialog
          title={`Delete ${serviceAccount.name}?`}
          onClose={() => setMode(undefined)}
          footer={
            <>
              <button className="btn ghost" type="button" onClick={() => setMode(undefined)}>
                Cancel
              </button>
              <button
                className="btn danger-solid"
                type="button"
                onClick={() =>
                  void act(
                    () => call("serviceAccounts.delete", { teamId, serviceAccountId: serviceAccount.id }),
                    `${serviceAccount.name} is deleted.`,
                  )
                }
              >
                Delete service account
              </button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--fg-muted)", lineHeight: "19px" }}>
            Its API keys and connected agents stop working at once. Its activity and notes stay, under its name.
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </span>
  )
}
