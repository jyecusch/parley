import {
  type Permission,
  ROLE_PERMISSIONS,
  type ServiceAccount,
  type Team,
  type TeamId,
  type UserId,
} from "@parley/domain"
import { DisplayName, type UserText, userText } from "@parley/errors"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { AlertIcon, CheckIcon, ChevronDown, CloseIcon } from "../components/icons.tsx"
import { initialsOf, SCOPE_LABELS } from "../components/settings.tsx"
import { agentRequest, getSession, signOut, withAgentRequest } from "../lib/auth.ts"
import { call, messageOf } from "../lib/client.ts"

/**
 * The consent page an agent's OAuth sign-in lands on (D89, D92). Choosing the team, who the
 * agent acts as and its scopes records a connection; Better-Auth then finishes the sign-in.
 */
export const Route = createFileRoute("/connect")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) {
      window.location.assign(withAgentRequest("/sign-in"))
      return new Promise<never>(() => {})
    }
    return { user: session.user }
  },
  component: Connect,
})

/**
 * The agent asking for access. Its name is whatever it chose when it registered itself, so the page
 * says so, and shows where access is actually sent: the redirect address in the signed request.
 */
interface Agent {
  readonly name: string
  /** The host the authorization goes to, or "an app on this computer" for a loopback address. */
  readonly destination: string | undefined
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

const destinationOf = (request: string): string | undefined => {
  try {
    const url = new URL(new URLSearchParams(request).get("redirect_uri") ?? "")
    if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}//${url.host}`
    return LOOPBACK.has(url.hostname) ? "an app on this computer" : url.hostname || undefined
  } catch {
    return undefined
  }
}

const loadAgent = async (clientId: string, request: string): Promise<Agent> => {
  const response = await fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, {
    credentials: "same-origin",
  })
  if (!response.ok) throw new Error("unknown agent")
  // The logo isn't shown: it's loaded from wherever the agent says, which would tell that site who opened this page.
  const client = (await response.json()) as { client_name?: string }
  return { name: client.client_name?.trim() || "Your agent", destination: destinationOf(request) }
}

/** Better-Auth's consent step, after the connection is recorded. Returns where the agent waits. */
const finishConsent = async (request: string, accept: boolean): Promise<string> => {
  const response = await fetch("/api/auth/oauth2/consent", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept, oauth_query: request }),
  })
  const body = (await response.json().catch(() => ({}))) as { url?: string }
  if (!response.ok || !body.url) throw new Error("consent failed")
  return body.url
}

const OFFERED: ReadonlyArray<Permission> = ["records:read", "records:write", "records:delete"]
const NEW = "new"
/** How long the result shows before the browser goes back to the agent. */
const HANDOFF_MS = 1200

const invalidRequest = userText`This connection request has expired or isn't valid. Start connecting again from your agent.`

function Connect() {
  const { user } = Route.useRouteContext()
  const [request] = useState(agentRequest)
  const clientId = request ? new URLSearchParams(request).get("client_id") : null
  const agent = useQuery({
    queryKey: ["agent", clientId],
    queryFn: () => loadAgent(clientId ?? "", request ?? ""),
    enabled: clientId !== null,
    retry: false,
  })
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => call("teams.list", {}) })

  return (
    <div className="consent">
      <header className="top">
        <span className="logo" aria-hidden="true">
          P
        </span>
        <span>Parley</span>
      </header>
      <main className="stage">
        <div className="sheet">
          {!request || agent.isError ? (
            <Problem title="This link doesn't work" message={invalidRequest} />
          ) : agent.isPending || teams.isPending ? (
            <div className="done" role="status" aria-label="Loading">
              <span className="sk" style={{ width: 160 }} />
            </div>
          ) : teams.isError ? (
            <Problem title="Parley couldn't load your teams" message={messageOf(teams.error)} />
          ) : teams.data.length === 0 ? (
            <NoTeam agent={agent.data} />
          ) : (
            <ConsentForm request={request} agent={agent.data} teams={teams.data} user={user} />
          )}
        </div>
      </main>
    </div>
  )
}

function Problem(props: { readonly title: string; readonly message: UserText }) {
  return (
    <div className="done" role="alert">
      <div className="e-ic no">
        <AlertIcon size={18} />
      </div>
      <h2>{props.title}</h2>
      <p>{props.message}</p>
    </div>
  )
}

function NoTeam(props: { readonly agent: Agent }) {
  return (
    <div className="done">
      <h2>Create a team first</h2>
      <p>{props.agent.name} works in one of your teams, and you aren't in one yet.</p>
      <a className="btn primary" style={{ marginTop: 10 }} href={withAgentRequest("/new-team")}>
        Create a team
      </a>
    </div>
  )
}

function AgentHeader(props: {
  readonly agent: Agent
  readonly user: { readonly name: string; readonly email: string }
}) {
  return (
    <div className="a-h">
      <div className="pair" aria-hidden="true">
        <span className="big">{initialsOf(props.agent.name)}</span>
        <svg
          width="28"
          height="12"
          viewBox="0 0 28 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="2 4"
          aria-hidden="true"
        >
          <path d="M2 6h24" />
        </svg>
        <span className="big p">P</span>
      </div>
      <h1>{props.agent.name} wants to work in Parley</h1>
      <span className="origin sm-t">
        Unverified agent: it named itself. Access goes to{" "}
        <b>{props.agent.destination ?? "an address Parley can't read"}</b>.
      </span>
      <p className="sm-t">
        Signed in as {props.user.name} · {props.user.email} ·{" "}
        <button
          className="linkish"
          type="button"
          onClick={async () => {
            await signOut()
            window.location.assign(withAgentRequest("/sign-in"))
          }}
        >
          Not you?
        </button>
      </p>
    </div>
  )
}

type Result = { readonly _tag: "Allowed"; readonly actsAs: string } | { readonly _tag: "Denied" }

function ConsentForm(props: {
  readonly request: string
  readonly agent: Agent
  readonly teams: ReadonlyArray<Team>
  readonly user: { readonly id: string; readonly name: string; readonly email: string }
}) {
  const [teamId, setTeamId] = useState<TeamId>(props.teams[0]?.id as TeamId)
  const team = props.teams.find((candidate) => candidate.id === teamId) ?? props.teams[0]
  const canCreate = team ? ROLE_PERMISSIONS[team.role].has("service-accounts:manage") : false
  const serviceAccounts = useQuery({
    queryKey: ["service-accounts", teamId],
    queryFn: () => call("serviceAccounts.list", { teamId }),
  })
  // Admins default to a new service account, members to themselves (D100).
  const [actor, setActor] = useState<string | undefined>()
  const chosen = actor ?? (canCreate ? NEW : props.user.id)
  const [newName, setNewName] = useState(props.agent.name)
  const [scopes, setScopes] = useState<ReadonlySet<Permission>>(new Set(["records:read"]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const [result, setResult] = useState<Result>()

  if (!team) return null

  const handOff = (url: string) => window.setTimeout(() => window.location.assign(url), HANDOFF_MS)

  const allow = async () => {
    setBusy(true)
    setError(undefined)
    try {
      let actsAs: UserId | undefined
      let actsAsName = "you"
      if (chosen === NEW) {
        const created = await call("serviceAccounts.create", { teamId, name: newName.trim() })
        // If a later step fails, trying again uses this service account rather than creating another.
        setActor(created.id)
        void serviceAccounts.refetch()
        actsAs = created.id
        actsAsName = created.name
      } else if (chosen !== props.user.id) {
        actsAs = chosen as UserId
        actsAsName = serviceAccounts.data?.find((account) => account.id === chosen)?.name ?? "a service account"
      }
      await call("connections.create", {
        teamId,
        request: props.request,
        scopes: OFFERED.filter((scope) => scopes.has(scope)),
        ...(actsAs ? { actsAs } : {}),
      })
      const url = await finishConsent(props.request, true).catch(() => undefined)
      if (!url) {
        setError(
          userText`Parley couldn't finish connecting ${DisplayName.fromRecord(props.agent.name)}. Start connecting again from your agent.`,
        )
        setBusy(false)
        return
      }
      setResult({ _tag: "Allowed", actsAs: actsAsName })
      handOff(url)
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  const deny = async () => {
    setBusy(true)
    try {
      const url = await finishConsent(props.request, false)
      setResult({ _tag: "Denied" })
      handOff(url)
    } catch {
      setError(invalidRequest)
      setBusy(false)
    }
  }

  if (result?._tag === "Allowed") {
    const words = OFFERED.filter((scope) => scopes.has(scope)).map((scope) => scope.slice(8))
    return (
      <div className="done" role="status">
        <div className="e-ic">
          <CheckIcon size={18} />
        </div>
        <h2>
          {props.agent.name} is connected to {team.name}
        </h2>
        <p>
          It acts as {result.actsAs} with {words.join(", ")} access. You can close this tab and go back to{" "}
          {props.agent.name}.
        </p>
      </div>
    )
  }
  if (result?._tag === "Denied") {
    return (
      <div className="done" role="status">
        <div className="e-ic no">
          <CloseIcon size={18} />
        </div>
        <h2>{props.agent.name} wasn't connected</h2>
        <p>Nothing changed in Parley. You can close this tab.</p>
      </div>
    )
  }

  const actors: ReadonlyArray<{
    readonly id: string
    readonly label: string
    readonly initials: string
    readonly kind: "you" | "bot" | "new"
    readonly description: string
  }> = [
    {
      id: props.user.id,
      label: `You (${props.user.name})`,
      initials: initialsOf(props.user.name),
      kind: "you",
      description: `Changes show as “${props.user.name} via ${props.agent.name}”. Your role: ${team.role}.`,
    },
    ...(serviceAccounts.data ?? []).map((account: ServiceAccount) => ({
      id: account.id,
      label: account.name,
      initials: initialsOf(account.name),
      kind: "bot" as const,
      description: canCreate
        ? `Service account · ${account.role}. Changes show as “${account.name} via ${props.agent.name}”.`
        : `Service account · ${account.role}. Limited to the lower of its role and yours.`,
    })),
    ...(canCreate
      ? [
          {
            id: NEW,
            label: "New service account…",
            initials: "+",
            kind: "new" as const,
            description: "Created as a member when you allow. Only admins and owners see this.",
          },
        ]
      : []),
  ]

  const toggle = (scope: Permission) =>
    setScopes((current) => {
      const next = new Set(current)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })

  const blocked = busy || (chosen === NEW && newName.trim() === "")

  return (
    <>
      <AgentHeader agent={props.agent} user={props.user} />
      <form
        className="a-b"
        onSubmit={(event) => {
          event.preventDefault()
          if (!blocked) void allow()
        }}
      >
        <div className="fld">
          <label className="fl" htmlFor="team">
            Team
          </label>
          <div className="selwrap">
            <span className="logo sel-logo" aria-hidden="true">
              {team.name[0]?.toUpperCase()}
            </span>
            <select
              className="sel"
              id="team"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value as TeamId)
                setActor(undefined)
              }}
            >
              {props.teams.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <span className="sel-chev">
              <ChevronDown />
            </span>
          </div>
          <p className="hint sm-t">A connection works in one team. Connect again to use another.</p>
        </div>

        <fieldset className="fld">
          <legend>Act as</legend>
          <div className="radios">
            {actors.map((option) => (
              <label key={option.id} className={`ropt ${chosen === option.id ? "on" : ""}`}>
                <input
                  className="rd"
                  type="radio"
                  name="actor"
                  checked={chosen === option.id}
                  onChange={() => setActor(option.id)}
                />
                <span className="t">
                  <span className="n">
                    <span
                      className={`av ${option.kind === "bot" ? "bot" : option.kind === "new" ? "bot new" : ""}`}
                      aria-hidden="true"
                    >
                      {option.initials}
                    </span>
                    {option.label}
                  </span>
                  <span className="d sm-t">{option.description}</span>
                  {option.id === NEW && chosen === NEW ? (
                    <input
                      className="inp"
                      type="text"
                      aria-label="Service account name"
                      placeholder="e.g. Sales Agent"
                      maxLength={60}
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                    />
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="fld">
          <legend>Scopes</legend>
          <div className="checks">
            {OFFERED.map((scope) => {
              const locked = scope === "records:read"
              return (
                <label key={scope} className="chk">
                  <input
                    className={`cb ${locked ? "locked" : ""}`}
                    type="checkbox"
                    checked={scopes.has(scope)}
                    disabled={locked}
                    onChange={() => toggle(scope)}
                  />
                  <span className="mono">{scope}</span>
                  <span className="d">
                    {SCOPE_LABELS[scope]}
                    {locked ? <span className="why"> · Always on</span> : null}
                  </span>
                </label>
              )
            })}
          </div>
          <p className="hint sm-t" style={{ marginTop: 4 }}>
            A connection never does more than the identity it acts as.
          </p>
        </fieldset>

        {error ? (
          <div className="alert" role="alert">
            <span className="ic">
              <AlertIcon />
            </span>
            <p>{error}</p>
          </div>
        ) : null}
      </form>

      <div className="a-f">
        <div className="btns">
          <button className="btn" type="button" disabled={busy} onClick={() => void deny()}>
            Deny
          </button>
          <button className="btn primary" type="button" disabled={blocked} onClick={() => void allow()}>
            Allow
          </button>
        </div>
        <p className="small sm-t">You can revoke this connection anytime in Settings → Connections.</p>
      </div>
    </>
  )
}
