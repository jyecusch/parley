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
import { type HTMLAttributes, useState } from "react"
import { AlertIcon, CheckIcon, CloseIcon } from "../components/icons.tsx"
import { ParleyMark } from "../components/logo.tsx"
import { initialsOf, SCOPE_LABELS } from "../components/settings.tsx"
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  Checkbox,
  cn,
  EmptyState,
  Field,
  Fieldset,
  Hint,
  Input,
  Notice,
  Option,
  RadioCard,
  Select,
  Skeleton,
} from "../components/ui/index.ts"
import { LinkButton } from "../components/ui/public.tsx"
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
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-16 items-center gap-2.5 px-6 font-medium">
        <ParleyMark className="h-5" />
        <span>Parley</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-12 pb-16 max-sm:px-0 max-sm:pt-2 max-sm:pb-6">
        <Card className="w-full max-w-lg rounded-2xl max-sm:rounded-none max-sm:shadow-none">
          {!request || agent.isError ? (
            <Problem title="This link doesn't work" message={invalidRequest} />
          ) : agent.isPending || teams.isPending ? (
            <Outcome role="status" aria-label="Loading">
              <Skeleton className="w-48" />
            </Outcome>
          ) : teams.isError ? (
            <Problem title="Parley couldn't load your teams" message={messageOf(teams.error)} />
          ) : teams.data.length === 0 ? (
            <NoTeam agent={agent.data} />
          ) : (
            <ConsentForm request={request} agent={agent.data} teams={teams.data} user={user} />
          )}
        </Card>
      </main>
    </div>
  )
}

/** The sheet's content when there's nothing to choose: a result, a problem or a next step. */
function Outcome({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid place-items-center px-8 py-11", className)} {...props} />
}

function Problem(props: { readonly title: string; readonly message: UserText }) {
  return (
    <Outcome role="alert">
      <EmptyState icon={<AlertIcon className="size-5.5" />} title={props.title}>
        {props.message}
      </EmptyState>
    </Outcome>
  )
}

function NoTeam(props: { readonly agent: Agent }) {
  return (
    <Outcome>
      <EmptyState
        title="Create a team first"
        actions={
          <a className={buttonClass({ variant: "primary" })} href={withAgentRequest("/new-team")}>
            Create a team
          </a>
        }
      >
        {props.agent.name} works in one of your teams, and you aren't in one yet.
      </EmptyState>
    </Outcome>
  )
}

function AgentHeader(props: {
  readonly agent: Agent
  readonly user: { readonly name: string; readonly email: string }
}) {
  return (
    <div className="flex flex-col items-center gap-2 border-b border-line px-8 pt-8 pb-6 text-center max-sm:px-4">
      <div className="mb-3 flex items-center gap-3 text-subtle" aria-hidden="true">
        <span className="grid size-12 place-items-center rounded-xl bg-fill text-base font-semibold text-fg">
          {initialsOf(props.agent.name)}
        </span>
        <svg
          className="h-3 w-8"
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
        <span className="grid size-12 place-items-center">
          <ParleyMark className="h-9" />
        </span>
      </div>
      <h1 className="m-0 text-xl font-semibold tracking-tight text-balance">
        {props.agent.name} wants to work in Parley
      </h1>
      <span className="text-sm text-muted">
        Unverified agent: it named itself. Access goes to{" "}
        <b className="font-medium text-fg">{props.agent.destination ?? "an address Parley can't read"}</b>.
      </span>
      <p className="m-0 text-sm text-muted">
        Signed in as {props.user.name} · {props.user.email} ·{" "}
        <LinkButton
          onClick={async () => {
            await signOut()
            window.location.assign(withAgentRequest("/sign-in"))
          }}
        >
          Not you?
        </LinkButton>
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
      <Outcome role="status">
        <EmptyState
          tone="ok"
          icon={<CheckIcon className="size-5.5" />}
          title={`${props.agent.name} is connected to ${team.name}`}
        >
          It acts as {result.actsAs} with {words.join(", ")} access. You can close this tab and go back to{" "}
          {props.agent.name}.
        </EmptyState>
      </Outcome>
    )
  }
  if (result?._tag === "Denied") {
    return (
      <Outcome role="status">
        <EmptyState icon={<CloseIcon className="size-5.5" />} title={`${props.agent.name} wasn't connected`}>
          Nothing changed in Parley. You can close this tab.
        </EmptyState>
      </Outcome>
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
        className="flex flex-col gap-6 px-8 pt-6 pb-2.5 max-sm:px-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!blocked) void allow()
        }}
      >
        <Field label="Team" htmlFor="team" hint="A connection works in one team. Connect again to use another.">
          <Select
            id="team"
            leading={<TeamLogo name={team.name} />}
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
          </Select>
        </Field>

        <Fieldset legend="Act as">
          {actors.map((option) => (
            <RadioCard
              key={option.id}
              name="actor"
              checked={chosen === option.id}
              onChange={() => setActor(option.id)}
              label={
                <>
                  <Avatar shape={option.kind === "you" ? "round" : "square"} dashed={option.kind === "new"}>
                    {option.initials}
                  </Avatar>
                  {option.label}
                </>
              }
              description={option.description}
            >
              {option.id === NEW && chosen === NEW ? (
                <Input
                  className="mt-1.5 bg-surface"
                  type="text"
                  aria-label="Service account name"
                  placeholder="e.g. Sales Agent"
                  maxLength={60}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              ) : null}
            </RadioCard>
          ))}
        </Fieldset>

        <Fieldset legend="Scopes">
          <div className="flex flex-col gap-0.5">
            {OFFERED.map((scope) => {
              const locked = scope === "records:read"
              return (
                <Option key={scope} className="grid grid-cols-[1rem_8rem_minmax(0,1fr)] py-0.5">
                  <Checkbox
                    className={cn(locked && "disabled:opacity-55")}
                    checked={scopes.has(scope)}
                    disabled={locked}
                    onChange={() => toggle(scope)}
                  />
                  <span className="font-mono text-sm">{scope}</span>
                  <span className="text-muted">
                    {SCOPE_LABELS[scope]}
                    {locked ? <span className="text-sm text-subtle"> · Always on</span> : null}
                  </span>
                </Option>
              )
            })}
          </div>
          <Hint className="mt-1">A connection never does more than the identity it acts as.</Hint>
        </Fieldset>

        {error ? (
          <Notice tone="danger" icon={<AlertIcon />}>
            {error}
          </Notice>
        ) : null}
      </form>

      <div className="flex flex-col gap-3 px-8 pt-4 pb-6 max-sm:px-4">
        <div className="grid grid-cols-2 gap-2.5">
          <Button size="lg" disabled={busy} onClick={() => void deny()}>
            Deny
          </Button>
          <Button variant="primary" size="lg" disabled={blocked} onClick={() => void allow()}>
            Allow
          </Button>
        </div>
        <p className="m-0 text-center text-sm text-subtle">
          You can revoke this connection anytime in Settings → Connections.
        </p>
      </div>
    </>
  )
}

/** A team's mark: its initial on a dark square. */
function TeamLogo(props: { readonly name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-5.5 place-items-center rounded-md bg-primary text-2xs font-semibold text-on-primary"
    >
      {props.name[0]?.toUpperCase()}
    </span>
  )
}
