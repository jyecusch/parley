import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { TemplateIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/templates/")({ component: TemplatesScreen })

const teamRoute = getRouteApi("/t/$teamId")

/** The templates index view (R41): content a new campaign can start from. */
function TemplatesScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const canWrite = ROLE_PERMISSIONS[team.role].has("email:write")
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const templates = useQuery({ queryKey: ["templates", teamId], queryFn: () => call("templates.list", { teamId }) })
  const items = templates.data ?? []

  const create = async () => {
    try {
      const template = await call("templates.create", { teamId, name: "Untitled template" })
      await navigate({ to: "/t/$teamId/templates/$templateId", params: { teamId, templateId: template.id } })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  const newButton = canWrite ? (
    <button className="btn primary" type="button" onClick={() => void create()}>
      New template
    </button>
  ) : null

  return (
    <main className="card main">
      <div className="hd1">
        <h1 className="crumb">
          <span>Templates</span>
        </h1>
        {items.length > 0 ? <span className="count">{items.length}</span> : null}
        <div className="spacer" />
        {items.length > 0 ? newButton : null}
      </div>
      <div className="body">
        {error ? (
          <p className="err sm-t" role="alert" style={{ padding: "8px 14px" }}>
            {error}
          </p>
        ) : null}
        {templates.isPending ? null : templates.isError ? (
          <LoadFailed
            title="Templates didn't load"
            message={messageOf(templates.error)}
            onRetry={() => void templates.refetch()}
          />
        ) : items.length === 0 ? (
          <div className="center">
            <div className="empty">
              <div className="e-ic">
                <TemplateIcon />
              </div>
              <h2>No templates yet</h2>
              <p>Save the emails you send often as templates. A new campaign can start from one.</p>
              {newButton ? <div className="actions">{newButton}</div> : null}
            </div>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="ctable">
              <caption className="vh">Templates</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ paddingLeft: 14 }}>
                    Name
                  </th>
                  <th className="col-wide" scope="col">
                    Subject
                  </th>
                  <th className="w-date" scope="col">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((template) => (
                  <tr key={template.id}>
                    <td style={{ paddingLeft: 14 }}>
                      <Link
                        className="namebtn"
                        to="/t/$teamId/templates/$templateId"
                        params={{ teamId, templateId: template.id }}
                      >
                        <span className="tile" aria-hidden="true">
                          <TemplateIcon size={12} />
                        </span>
                        <span className="n">{template.name}</span>
                      </Link>
                    </td>
                    <td className={`col-wide ${template.subject ? "c-muted" : "c-none"}`}>
                      {template.subject || "No subject"}
                    </td>
                    <td className="c-date" title={absolute(template.updatedAt)}>
                      {relative(template.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
