import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { SegmentIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Dialog } from "../components/settings.tsx"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/segments/")({ component: SegmentsScreen })

const teamRoute = getRouteApi("/t/$teamId")

/** The segments index view (D23): every segment with how many contacts it has now. */
function SegmentsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const [creating, setCreating] = useState(false)
  const segments = useQuery({ queryKey: ["segments", teamId], queryFn: () => call("segments.list", { teamId }) })
  const items = segments.data ?? []

  return (
    <main className="card main">
      <div className="hd1">
        <h1 className="crumb">
          <span>Segments</span>
        </h1>
        {items.length > 0 ? <span className="count">{items.length}</span> : null}
        <div className="spacer" />
        {canWrite && items.length > 0 ? (
          <button className="btn primary" type="button" onClick={() => setCreating(true)}>
            New segment
          </button>
        ) : null}
      </div>
      <div className="body">
        {segments.isPending ? null : segments.isError ? (
          <LoadFailed
            title="Segments didn't load"
            message={messageOf(segments.error)}
            onRetry={() => void segments.refetch()}
          />
        ) : items.length === 0 ? (
          <div className="center">
            <div className="empty">
              <div className="e-ic">
                <SegmentIcon />
              </div>
              <h2>No segments yet</h2>
              <p>
                A segment is who a campaign goes to: either everyone matching a filter, which keeps up as contacts
                change, or a list you pick by hand.
              </p>
              {canWrite ? (
                <div className="actions">
                  <button className="btn primary" type="button" onClick={() => setCreating(true)}>
                    New segment
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="ctable">
              <caption className="vh">Segments</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ paddingLeft: 14 }}>
                    Name
                  </th>
                  <th className="w-kind" scope="col">
                    Kind
                  </th>
                  <th className="w-count" scope="col">
                    Contacts
                  </th>
                  <th className="w-count col-wide" scope="col" title="Subscribed, with an email address">
                    Can be sent
                  </th>
                  <th className="w-date col-wide" scope="col">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((segment) => (
                  <tr key={segment.id}>
                    <td style={{ paddingLeft: 14 }}>
                      <Link
                        className="namebtn"
                        to="/t/$teamId/segments/$segmentId"
                        params={{ teamId, segmentId: segment.id }}
                      >
                        <span className="tile" aria-hidden="true">
                          <SegmentIcon className="size-3.5" />
                        </span>
                        <span className="n">{segment.name}</span>
                      </Link>
                    </td>
                    <td className="c-muted">{segment.kind === "dynamic" ? "Dynamic" : "Fixed"}</td>
                    <td className="tab">{segment.contactCount}</td>
                    <td className="tab col-wide">{segment.sendableCount}</td>
                    <td className="c-date col-wide" title={absolute(segment.updatedAt)}>
                      {relative(segment.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating ? <NewSegmentDialog teamId={teamId} onClose={() => setCreating(false)} /> : null}
    </main>
  )
}

function NewSegmentDialog(props: { readonly teamId: TeamId; readonly onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"dynamic" | "fixed">("dynamic")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const segment = await call("segments.create", { teamId: props.teamId, name: name.trim(), kind })
      await navigate({ to: "/t/$teamId/segments/$segmentId", params: { teamId: props.teamId, segmentId: segment.id } })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="New segment"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={!name.trim() || busy} onClick={() => void create()}>
            Create segment
          </button>
        </>
      }
    >
      <div className="fld">
        <label className="fl" htmlFor="segment-name">
          Name
        </label>
        <input
          id="segment-name"
          className="inp"
          maxLength={80}
          placeholder="Customers in Australia"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) void create()
          }}
        />
      </div>
      <fieldset className="fld">
        <legend className="fl">Kind</legend>
        <div className="radios">
          <label className={`ropt ${kind === "dynamic" ? "on" : ""}`}>
            <input
              className="rd"
              type="radio"
              name="kind"
              checked={kind === "dynamic"}
              onChange={() => setKind("dynamic")}
            />
            <span className="t">
              <span className="n">Dynamic</span>
              <span className="d sm-t">Everyone matching a filter. It keeps up as contacts change.</span>
            </span>
          </label>
          <label className={`ropt ${kind === "fixed" ? "on" : ""}`}>
            <input
              className="rd"
              type="radio"
              name="kind"
              checked={kind === "fixed"}
              onChange={() => setKind("fixed")}
            />
            <span className="t">
              <span className="n">Fixed</span>
              <span className="d sm-t">Contacts you pick by hand.</span>
            </span>
          </label>
        </div>
      </fieldset>
      {error ? (
        <p className="err sm-t" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
