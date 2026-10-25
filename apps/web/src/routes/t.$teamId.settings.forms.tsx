import { type FormSettings, ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CheckIcon, InfoIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { LoadingRows, SettingsPage, useToast } from "../components/settings.tsx"
import {
  Button,
  Checkbox,
  Field,
  Fieldset,
  Hint,
  Input,
  Notice,
  Option,
  RadioCard,
  RadioCards,
  Select,
} from "../components/ui/index.ts"
import { SettingsPanel } from "../components/ui/settings-extra.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/forms")({ component: FormSettingsScreen })

const teamRoute = getRouteApi("/t/$teamId")

const ALWAYS_ON = [
  "A signed token per visit, used once",
  "Too-fast submissions caught",
  "A hidden field bots fill in",
  "Limits per visitor, form and address",
  "Email addresses checked for a mail server",
  "Spam kept 30 days, with the reason",
]

/** Settings for every form the team has (D147): the captcha, email checks and privacy link. */
function FormSettingsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const canManage = ROLE_PERMISSIONS[team.role].has("email:manage")
  const queryClient = useQueryClient()
  const [, showToast] = useToast()
  const settings = useQuery({
    queryKey: ["form-settings", teamId],
    queryFn: () => call("formSettings.get", { teamId }),
  })

  const save = async (changes: Omit<Parameters<typeof call<"formSettings.update">>[1], "teamId">) => {
    const next = await call("formSettings.update", { teamId, ...changes })
    queryClient.setQueryData(["form-settings", teamId], next)
    showToast("Saved.")
    return next
  }

  return (
    <SettingsPage title="Forms" intro="Bot protection and consent for every form. Visitors never see a puzzle.">
      {canManage ? null : <Notice icon={<InfoIcon />}>Only owners and admins can change these.</Notice>}
      {settings.isPending ? <LoadingRows /> : null}
      {settings.isError ? (
        <LoadFailed
          title="Form settings didn't load"
          message={messageOf(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      ) : null}
      {settings.data ? (
        <FormSettingsPanels settings={settings.data} canManage={canManage} save={save} onError={showToast} />
      ) : null}
    </SettingsPage>
  )
}

type Save = (changes: {
  readonly captcha?:
    | { readonly provider: "builtin" }
    | {
        readonly provider: "turnstile"
        readonly siteKey: string
        readonly mode: "invisible" | "managed"
        readonly secretKey?: string
      }
  readonly blockDisposableEmails?: boolean
  readonly privacyPolicyUrl?: string | null
}) => Promise<FormSettings>

function FormSettingsPanels(props: {
  readonly settings: FormSettings
  readonly canManage: boolean
  readonly save: Save
  readonly onError: (text: string) => void
}) {
  const { settings, canManage } = props
  const turnstile = settings.captcha.provider === "turnstile" ? settings.captcha : undefined
  const [provider, setProvider] = useState<"builtin" | "turnstile">(settings.captcha.provider)
  const [siteKey, setSiteKey] = useState(turnstile?.siteKey ?? "")
  const [mode, setMode] = useState<"invisible" | "managed">(turnstile?.mode ?? "invisible")
  const [secret, setSecret] = useState("")
  const [replacing, setReplacing] = useState(!turnstile?.hasSecret)
  const [privacy, setPrivacy] = useState(settings.privacyPolicyUrl ?? "")
  const [busy, setBusy] = useState(false)
  useEffect(() => setReplacing(!turnstile?.hasSecret), [turnstile?.hasSecret])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } catch (failure) {
      props.onError(messageOf(failure))
    }
    setBusy(false)
  }

  const turnstileReady = siteKey.trim() !== "" && (secret.trim() !== "" || turnstile?.hasSecret === true)
  const saveTurnstile = () =>
    run(async () => {
      await props.save({
        captcha: {
          provider: "turnstile",
          siteKey: siteKey.trim(),
          mode,
          ...(secret.trim() ? { secretKey: secret.trim() } : {}),
        },
      })
      setSecret("")
    })

  return (
    <>
      <SettingsPanel>
        <Fieldset legend="Captcha">
          <RadioCards
            name="captcha"
            value={provider}
            onChange={(next) => {
              setProvider(next)
              if (next === "builtin" && settings.captcha.provider !== "builtin") {
                void run(() => props.save({ captcha: { provider: "builtin" } }))
              }
            }}
          >
            <RadioCard
              value="builtin"
              disabled={!canManage}
              label="Built in"
              description="Visitors' browsers solve a small puzzle in the background. Run by Parley: no third party, no cookies, nothing to set up."
            />
            <RadioCard
              value="turnstile"
              disabled={!canManage}
              label="Cloudflare Turnstile"
              description="Cloudflare's signals on top of the built-in checks. Uses a free Cloudflare account."
            />
          </RadioCards>
          {provider === "turnstile" ? (
            <div className="flex flex-col gap-3 pl-1">
              <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
                <Field label="Site key" htmlFor="turnstile-site">
                  <Input
                    id="turnstile-site"
                    disabled={!canManage}
                    value={siteKey}
                    placeholder="0x4AAAA…"
                    onChange={(event) => setSiteKey(event.target.value)}
                  />
                </Field>
                <Field label="Secret key" htmlFor="turnstile-secret">
                  {replacing ? (
                    <Input
                      id="turnstile-secret"
                      type="password"
                      autoComplete="off"
                      disabled={!canManage}
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                  ) : (
                    <div className="flex h-10 items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-sm text-muted">
                        <CheckIcon className="size-4" />
                        Stored encrypted
                      </span>
                      {canManage ? (
                        <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
                          Replace
                        </Button>
                      ) : null}
                    </div>
                  )}
                </Field>
                <Field label="Mode" htmlFor="turnstile-mode">
                  <Select
                    id="turnstile-mode"
                    disabled={!canManage}
                    value={mode}
                    onChange={(event) => setMode(event.target.value as "invisible" | "managed")}
                  >
                    <option value="invisible">Invisible</option>
                    <option value="managed">Managed</option>
                  </Select>
                </Field>
              </div>
              <Hint>
                In Cloudflare, add {typeof window === "undefined" ? "Parley's domain" : window.location.hostname} as the
                widget's hostname. It covers every site your forms are on. Managed shows a checkbox only to visitors
                Cloudflare isn't sure about.
              </Hint>
              {canManage ? (
                <Button
                  className="self-start"
                  variant="primary"
                  disabled={busy || !turnstileReady}
                  onClick={() => void saveTurnstile()}
                >
                  Use Turnstile
                </Button>
              ) : null}
            </div>
          ) : null}
        </Fieldset>
      </SettingsPanel>
      <SettingsPanel>
        <Fieldset legend="Always on">
          <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-2 p-0 text-sm text-muted max-md:grid-cols-1">
            {ALWAYS_ON.map((entry) => (
              <li key={entry} className="flex items-center gap-2">
                <CheckIcon className="size-4 text-subtle" />
                {entry}
              </li>
            ))}
          </ul>
          <Option className="mt-1">
            <Checkbox
              disabled={!canManage || busy}
              checked={settings.blockDisposableEmails}
              onChange={(event) => void run(() => props.save({ blockDisposableEmails: event.target.checked }))}
            />
            Also turn away disposable email addresses
          </Option>
        </Fieldset>
      </SettingsPanel>
      <SettingsPanel>
        <Field
          label="Privacy policy"
          htmlFor="privacy-url"
          info="Linked on every form, after the fine print under its button."
        >
          <div className="flex gap-1.5">
            <Input
              id="privacy-url"
              type="url"
              disabled={!canManage}
              placeholder="https://example.com/privacy"
              value={privacy}
              onChange={(event) => setPrivacy(event.target.value)}
            />
            {canManage ? (
              <Button
                size="lg"
                disabled={busy || privacy.trim() === (settings.privacyPolicyUrl ?? "")}
                onClick={() => void run(() => props.save({ privacyPolicyUrl: privacy.trim() || null }))}
              >
                Save
              </Button>
            ) : null}
          </div>
        </Field>
      </SettingsPanel>
    </>
  )
}
