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
import {
  Box,
  Button,
  Checkbox,
  cn,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  Input,
  Notice,
  Option,
  OutlineTag,
  SegmentedControl,
  Table,
  Td,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowIdentity } from "../components/ui/settings-extra.tsx"
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
        <Button variant="primary" size="sm" onClick={() => setDialog("new")}>
          New API key
        </Button>
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
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-[26%]">
                  Name
                </Th>
                <Th scope="col" className="w-[18%]">
                  Key
                </Th>
                <Th scope="col" className="w-[20%]">
                  Scopes
                </Th>
                <Th scope="col" className="w-28">
                  Created
                </Th>
                <Th scope="col" className="w-28">
                  Last used
                </Th>
                <Th scope="col" className="w-44">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {keys.data.map((apiKey) => (
                <Tr key={apiKey.id} className={cn(apiKey.revoked && "[&>td]:text-subtle")}>
                  <Td>
                    <div className={cn(apiKey.revoked && "opacity-60")}>
                      <RowIdentity name={apiKey.name} sub={expiryLine(apiKey)} />
                    </div>
                  </Td>
                  <Td className="font-mono text-sm">{apiKey.start ? `${apiKey.start}…` : "—"}</Td>
                  <Td className={cn(apiKey.revoked && "opacity-60")}>
                    <ScopeChips scopes={apiKey.scopes} />
                  </Td>
                  <Td>
                    <When at={apiKey.createdAt} />
                  </Td>
                  <Td>
                    <When at={apiKey.lastUsedAt} />
                  </Td>
                  <Td className="text-right">
                    {apiKey.revoked ? (
                      <span title="Requests with this key are refused">
                        <OutlineTag>Revoked</OutlineTag>
                      </span>
                    ) : (
                      <RevokeButton name={apiKey.name} onRevoke={() => revoke(apiKey)} />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || name.trim() === ""} onClick={() => void create()}>
            Create API key
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="key-name" hint="Shown in record activity, like “Jane Doe via Nightly CRM sync”.">
        <Input
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
      </Field>
      <Fieldset legend="Scopes">
        <div className="flex flex-col gap-0.5">
          {OFFERED.map((scope) => {
            const locked = scope === "records:read"
            const allowed = props.rolePermissions.has(scope)
            return (
              <Option
                key={scope}
                className={cn(
                  "grid min-h-8 grid-cols-[1rem_8.5rem_minmax(0,1fr)] items-center gap-2.5 py-0.5",
                  allowed ? "cursor-pointer" : "cursor-default [&>span]:opacity-50",
                )}
              >
                <Checkbox
                  className={cn(locked && "disabled:opacity-55")}
                  checked={allowed && scopes.has(scope)}
                  disabled={locked || !allowed}
                  onChange={() => toggle(scope)}
                />
                <span className="font-mono text-sm">{scope}</span>
                <span className="text-muted">
                  {SCOPE_LABELS[scope]}
                  {locked ? <span className="text-sm text-subtle"> · Always on</span> : null}
                  {allowed ? null : <span className="text-sm text-subtle"> · Your role can't grant this</span>}
                </span>
              </Option>
            )
          })}
        </div>
        <Hint className="mt-1.5">
          A key never does more than your role allows. Write and delete are off unless you turn them on.
        </Hint>
      </Fieldset>
      <Fieldset legend="Expiry">
        <SegmentedControl
          name="key-expiry"
          label="Expiry"
          options={EXPIRIES.map((days) => ({ value: String(days ?? "never"), label: days ? `${days} days` : "Never" }))}
          value={String(expiry ?? "never")}
          onChange={(value) => setExpiry(EXPIRIES.find((days) => String(days ?? "never") === value))}
        />
      </Fieldset>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

function ApiKeyCreated(props: {
  readonly teamId: TeamId
  readonly created: CreatedApiKey
  readonly onClose: () => void
}) {
  const { apiKey, secret } = props.created
  const curl = `curl "${window.location.origin}/api/v1/teams/${props.teamId}/contacts?limit=10" \\\n  -H "x-api-key: ${secret}"`
  return (
    <Dialog
      title="API key created"
      footer={
        <Button variant="primary" onClick={props.onClose}>
          Done
        </Button>
      }
    >
      <Notice tone="warn" icon={<WarnIcon />}>
        <span role="note">This is the only time you'll see this key. Store it somewhere safe.</span>
      </Notice>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">{apiKey.name}</span>
        <CopyField value={secret} label="API key" />
        <Hint>
          Scopes: {apiKey.scopes.join(", ")} ·{" "}
          {apiKey.expiresAt ? `Expires ${dateOnly(apiKey.expiresAt)}` : "Never expires"}
        </Hint>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Try it</span>
        <CopyField value={curl} label="example request" code />
      </div>
    </Dialog>
  )
}
