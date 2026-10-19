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
      <section className="box urlcard" aria-labelledby="mcp-h">
        <h3 className="vh" id="mcp-h">
          MCP URL
        </h3>
        <p>
          Add Parley as a custom connector in <b>Claude</b>, <b>ChatGPT</b>, <b>Claude Code</b>, <b>Cursor</b> or{" "}
          <b>opencode</b> using this URL:
        </p>
        <CopyField value={mcpUrl} label="MCP URL" />
        <p className="hint sm-t">
          Your agent opens Parley in the browser. You sign in, pick who it acts as, and it shows up below.
        </p>
      </section>

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
        <div className="box">
          <table className="stable">
            <thead>
              <tr>
                <th scope="col" style={{ width: "27%" }}>
                  Agent
                </th>
                <th scope="col" style={{ width: "17%" }}>
                  Acts as
                </th>
                <th scope="col" style={{ width: "19%" }}>
                  Scopes
                </th>
                <th scope="col" style={{ width: 96 }}>
                  Connected
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
              {visible?.map((connection) => {
                const isYou = connection.actsAs.kind === "user"
                return (
                  <tr key={connection.id}>
                    <td>
                      <div className="who">
                        <span className="tile" aria-hidden="true">
                          {initialsOf(connection.name)}
                        </span>
                        <span className="stack">
                          <span className="n">{connection.name}</span>
                          {connection.origin ? <span className="s sm-t">{connection.origin}</span> : null}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="as">
                        <span className={`av ${isYou ? "" : "bot"}`} aria-hidden="true">
                          {initialsOf(connection.actsAs.name)}
                        </span>
                        <span className="lbl">{isYou ? "You" : connection.actsAs.name}</span>
                      </span>
                    </td>
                    <td>
                      <ScopeChips scopes={connection.scopes} />
                    </td>
                    <td>
                      <When at={connection.authorizedAt} />
                    </td>
                    <td>
                      <When at={connection.lastUsedAt} />
                    </td>
                    <td className="c-act">
                      <RevokeButton name={connection.name} onRevoke={() => revoke(connection)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast}
    </SettingsPage>
  )
}
