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
import {
  Avatar,
  Box,
  Button,
  cn,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Notice,
  RadioCard,
  Table,
  Td,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { Byline, RowIdentity } from "../components/ui/settings-extra.tsx"
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
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            New service account
          </Button>
        ) : null
      }
    >
      {canManage ? null : (
        <Notice icon={<InfoIcon />}>
          Only admins and owners can create service accounts. You can still connect an agent as one of these when you
          approve it.
        </Notice>
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
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-[32%]">
                  Name
                </Th>
                <Th scope="col" className="w-[14%]">
                  Role
                </Th>
                <Th scope="col" className="w-[24%]">
                  Created by
                </Th>
                <Th scope="col" className="w-36">
                  Connections
                </Th>
                <Th scope="col" className="w-28">
                  Created
                </Th>
                {canManage ? (
                  <Th scope="col" className="w-16">
                    <span className="sr-only">Actions</span>
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {serviceAccounts.data.map((serviceAccount) => (
                <Tr key={serviceAccount.id}>
                  <Td>
                    <RowIdentity
                      mark={
                        <Avatar size="md" shape="square">
                          {initialsOf(serviceAccount.name)}
                        </Avatar>
                      }
                      name={serviceAccount.name}
                    />
                  </Td>
                  <Td className="text-muted">{roleLabel(serviceAccount.role)}</Td>
                  <Td>
                    {serviceAccount.createdBy ? (
                      <Byline mark={<Avatar>{initialsOf(serviceAccount.createdBy.name)}</Avatar>}>
                        {serviceAccount.createdBy.name}
                      </Byline>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </Td>
                  <Td className={cn(serviceAccount.connectionCount === 0 && "text-subtle")}>
                    {serviceAccount.connectionCount === 0
                      ? "None"
                      : `${serviceAccount.connectionCount} connection${serviceAccount.connectionCount === 1 ? "" : "s"}`}
                  </Td>
                  <Td>
                    <When at={serviceAccount.createdAt} />
                  </Td>
                  {canManage ? (
                    <Td className="overflow-visible text-right">
                      <ServiceAccountMenu
                        serviceAccount={serviceAccount}
                        teamId={teamId}
                        onDone={async (text) => {
                          if (text) showToast(text)
                          await queryClient.invalidateQueries({ queryKey: key })
                        }}
                      />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
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
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || name.trim() === ""} onClick={() => void create()}>
            Create service account
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="sa-name" hint="Changes made through it show as this name in record activity.">
        <Input
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
      </Field>
      <Fieldset legend="Role">
        {ROLES.map((option) => (
          <RadioCard
            key={option.role}
            name="sa-role"
            label={option.label}
            description={option.description}
            checked={role === option.role}
            onChange={() => setRole(option.role)}
          />
        ))}
        <Hint className="mt-1.5">
          An agent acting as it gets the lower of this role and the role of whoever connects it.
        </Hint>
      </Fieldset>
      {error ? <ErrorText>{error}</ErrorText> : null}
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
    <span className="relative inline-flex">
      <IconButton
        label={`More actions for ${serviceAccount.name}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon />
      </IconButton>
      {open ? (
        <Menu className="top-full right-0 mt-1 text-left">
          <MenuItem
            onClick={() => {
              setOpen(false)
              setName(serviceAccount.name)
              setMode("rename")
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
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
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            onClick={() => {
              setOpen(false)
              setMode("delete")
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      ) : null}
      {mode === "rename" ? (
        <Dialog
          title={`Rename ${serviceAccount.name}`}
          onClose={() => setMode(undefined)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setMode(undefined)}>
                Cancel
              </Button>
              <Button
                variant="primary"
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
              </Button>
            </>
          }
        >
          <Field label="Name" htmlFor="sa-rename" hint="Past activity keeps the name it had at the time.">
            <Input
              id="sa-rename"
              type="text"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Dialog>
      ) : null}
      {mode === "delete" ? (
        <Dialog
          title={`Delete ${serviceAccount.name}?`}
          onClose={() => setMode(undefined)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setMode(undefined)}>
                Cancel
              </Button>
              <Button
                variant="danger-solid"
                onClick={() =>
                  void act(
                    () => call("serviceAccounts.delete", { teamId, serviceAccountId: serviceAccount.id }),
                    `${serviceAccount.name} is deleted.`,
                  )
                }
              >
                Delete service account
              </Button>
            </>
          }
        >
          <p className="m-0 text-muted">
            Its API keys and connected agents stop working at once. Its activity and notes stay, under its name.
          </p>
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Dialog>
      ) : null}
    </span>
  )
}
