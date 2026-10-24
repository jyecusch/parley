import type { Connection, TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { ConnectionIcon } from "../components/icons.tsx"
import {
  CopyField,
  Empty,
  initialsOf,
  LoadFailed,
  LoadingRows,
  RevokeButton,
  ScopeChips,
  SettingsPage,
  useToast,
  When,
} from "../components/settings.tsx"
import { Avatar, Box, Hint, Table, Td, Th, Tr } from "../components/ui/index.ts"
import { Byline, RowIdentity, SettingsPanel } from "../components/ui/settings-extra.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/connections")({ component: Connections })

const team = getRouteApi("/t/$teamId")

function Connections() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const key = ["connections", teamId]
  const connections = useQuery({ queryKey: key, queryFn: () => call("connections.list", { teamId }) })
  const mcpUrl = `${window.location.origin}/mcp`

  const revoke = async (connection: Connection) => {
    try {
      const revoked = await call("connections.revoke", { teamId, connectionId: connection.id })
      queryClient.setQueryData<ReadonlyArray<Connection>>(key, (rows) =>
        rows?.map((row) => (row.id === revoked.id ? revoked : row)),
      )
      showToast(`${connection.name} is revoked. It can no longer reach ${current.name}.`)
    } catch (failure) {
      showToast(messageOf(failure))
    }
  }

  // Revoked connections can't come back, so they leave the list; pending ones never finished signing in.
  const visible = connections.data?.filter((row) => !row.revoked && row.authorizedAt !== null)

  return (
    <SettingsPage
      title="Connections"
      intro={`Agents you've connected to ${current.name}. Each one acts as you or as a service account, with the scopes you chose when you connected it.`}
    >
      <SettingsPanel aria-labelledby="mcp-h">
        <h3 className="sr-only" id="mcp-h">
          MCP URL
        </h3>
        <p className="m-0 text-muted [&_b]:font-medium [&_b]:text-fg">
          Add Parley as a custom connector in <b>Claude</b>, <b>ChatGPT</b>, <b>Claude Code</b>, <b>Cursor</b> or{" "}
          <b>opencode</b> using this URL:
        </p>
        <CopyField value={mcpUrl} label="MCP URL" />
        <Hint>Your agent opens Parley in the browser. You sign in, pick who it acts as, and it shows up below.</Hint>
      </SettingsPanel>

      {connections.isPending ? (
        <LoadingRows />
      ) : connections.isError ? (
        <LoadFailed
          title="Connections didn't load"
          message={messageOf(connections.error)}
          onRetry={() => void connections.refetch()}
        />
      ) : visible?.length === 0 ? (
        <Empty icon={<ConnectionIcon />} title="No agents connected yet">
          Paste the MCP URL above into your agent. When you approve it in the browser, it shows up here and you can
          revoke it anytime.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-27/100">
                  Agent
                </Th>
                <Th scope="col" className="w-17/100">
                  Acts as
                </Th>
                <Th scope="col" className="w-19/100">
                  Scopes
                </Th>
                <Th scope="col" className="w-28">
                  Connected
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
              {visible?.map((connection) => {
                const isYou = connection.actsAs.kind === "user"
                return (
                  <Tr key={connection.id}>
                    <Td>
                      <RowIdentity
                        mark={
                          <Avatar size="md" shape="square">
                            {initialsOf(connection.name)}
                          </Avatar>
                        }
                        name={connection.name}
                        sub={connection.origin}
                      />
                    </Td>
                    <Td>
                      <Byline
                        mark={<Avatar shape={isYou ? "round" : "square"}>{initialsOf(connection.actsAs.name)}</Avatar>}
                      >
                        {isYou ? "You" : connection.actsAs.name}
                      </Byline>
                    </Td>
                    <Td>
                      <ScopeChips scopes={connection.scopes} />
                    </Td>
                    <Td>
                      <When at={connection.authorizedAt} />
                    </Td>
                    <Td>
                      <When at={connection.lastUsedAt} />
                    </Td>
                    <Td className="text-right">
                      <RevokeButton name={connection.name} onRevoke={() => revoke(connection)} />
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        </Box>
      )}
      {toast}
    </SettingsPage>
  )
}
