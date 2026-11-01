import { type UserText, userText } from "@parley/errors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import QRCode from "react-qr-code"
import { CopyIcon, DownloadIcon, PasskeyIcon } from "../components/icons.tsx"
import { NewPasswordField } from "../components/new-password.tsx"
import { CopyField, Empty, LoadFailed, LoadingRows, SettingsPage, useToast, When } from "../components/settings.tsx"
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  ErrorText,
  Field,
  Hint,
  InfoTip,
  Input,
  Option,
  Table,
  Td,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowActions, SettingsPanel, SettingsSectionHeading } from "../components/ui/settings-extra.tsx"
import { forgetSession, getSession, type Passkey, security } from "../lib/auth.ts"

export const Route = createFileRoute("/t/$teamId/settings/security")({ component: Security })

/** What a dialog's work returns: why it failed, or nothing when it worked. */
type Attempt = Promise<UserText | undefined>

/** How you sign in (D172): your password, two-factor authentication and passkeys. */
function Security() {
  const queryClient = useQueryClient()
  const [, showToast] = useToast()
  // Read fresh each time the page opens and never kept after, so it can't show whoever was signed
  // in before in this tab. getSession itself forgets on every sign-in and sign-out.
  const session = useQuery({ queryKey: ["security", "session"], queryFn: getSession, staleTime: 0, gcTime: 0 })
  const userId = session.data?.user.id
  const [dialog, setDialog] = useState<"password" | "turn-on" | "turn-off" | "codes">()
  const refresh = async () => {
    forgetSession(undefined)
    await queryClient.invalidateQueries({ queryKey: ["security", "session"] })
  }
  const on = session.data?.user.twoFactorEnabled === true
  return (
    <SettingsPage
      title="Security"
      intro={session.data ? `How you sign in to Parley as ${session.data.user.email}.` : "How you sign in to Parley."}
    >
      <SettingsPanel aria-labelledby="password-heading">
        <div className="flex items-center gap-4">
          <h3 id="password-heading" className="m-0 flex-1 text-base font-semibold">
            Password
          </h3>
          <Button onClick={() => setDialog("password")}>Change password</Button>
        </div>
      </SettingsPanel>

      <SettingsPanel aria-labelledby="two-factor-heading">
        <div className="flex items-center gap-3">
          <h3 id="two-factor-heading" className="m-0 text-base font-semibold">
            Two-factor authentication
          </h3>
          {session.data ? <Badge tone={on ? "strong" : "neutral"}>{on ? "On" : "Off"}</Badge> : null}
          <span className="flex-1" />
          {session.data && !on ? (
            <Button variant="primary" onClick={() => setDialog("turn-on")}>
              Turn on
            </Button>
          ) : null}
        </div>
        <p className="m-0 text-muted">
          {on ? "Add an extra layer of security to your account." : "Protect your account with an authenticator app."}
        </p>
        {on ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-fill px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">Backup codes</span>
              <span className="text-sm text-muted">Each works once, if you lose your phone.</span>
            </div>
            <Button onClick={() => setDialog("codes")}>Make new codes</Button>
            <Button variant="danger" onClick={() => setDialog("turn-off")}>
              Turn off
            </Button>
          </div>
        ) : null}
      </SettingsPanel>

      {userId ? <Passkeys userId={userId} onToast={showToast} /> : null}

      {dialog === "password" ? (
        <ChangePassword
          context={session.data ? [session.data.user.name, session.data.user.email] : []}
          onClose={() => setDialog(undefined)}
          onChanged={async (signedOutElsewhere) => {
            setDialog(undefined)
            showToast(signedOutElsewhere ? "Password changed. You're signed out everywhere else." : "Password changed.")
            await refresh()
          }}
        />
      ) : null}
      {dialog === "turn-on" ? (
        <TurnOn
          onClose={async () => {
            setDialog(undefined)
            await refresh()
          }}
        />
      ) : null}
      {dialog === "turn-off" ? (
        <WithPassword
          title="Turn off two-factor authentication"
          explanation="Signing in will only need your password. Your backup codes stop working."
          action="Turn off"
          danger
          onClose={() => setDialog(undefined)}
          onConfirm={async (password) => {
            const turnedOff = await security.turnOffTwoFactor(password)
            if (turnedOff.failure !== undefined) return turnedOff.failure
            setDialog(undefined)
            showToast("Two-factor authentication is off.")
            await refresh()
            return undefined
          }}
        />
      ) : null}
      {dialog === "codes" ? <NewBackupCodes onClose={() => setDialog(undefined)} /> : null}
    </SettingsPage>
  )
}

function Passkeys(props: { readonly userId: string; readonly onToast: (text: string) => void }) {
  const queryClient = useQueryClient()
  // Keyed by whose they are, so another account signed in later in this tab never sees them.
  const key = ["passkeys", props.userId]
  const passkeys = useQuery({
    queryKey: key,
    queryFn: async () => {
      const listed = await security.passkeys()
      if (listed.failure !== undefined) throw new Error(listed.failure)
      return listed.data
    },
  })
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<Passkey>()
  const [removing, setRemoving] = useState<Passkey>()
  const reload = () => queryClient.invalidateQueries({ queryKey: key })
  return (
    <section aria-labelledby="passkeys-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex flex-1 items-center gap-1">
          <SettingsSectionHeading>
            <span id="passkeys-heading">Passkeys</span>
          </SettingsSectionHeading>
          <InfoTip label="passkeys" className="mt-2">
            Passkeys are much safer than passwords. They can't be guessed or reused, a fake site can't trick you into
            using one, and Parley never holds the secret part, so a leak of our data can't expose it.
          </InfoTip>
        </span>
        <Button variant="primary" className="mt-2" onClick={() => setAdding(true)}>
          Add a passkey
        </Button>
      </div>
      <p className="m-0 text-muted">Sign in with your fingerprint, face or device PIN instead of your password.</p>
      {passkeys.isPending ? (
        <LoadingRows />
      ) : passkeys.isError ? (
        <LoadFailed
          title="Passkeys didn't load"
          message={userText`Check your connection, then try again.`}
          onRetry={() => void passkeys.refetch()}
        />
      ) : passkeys.data.length === 0 ? (
        <Empty icon={<PasskeyIcon />} title="No passkeys yet">
          Add one on each device you sign in from.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col">Name</Th>
                <Th scope="col">Added</Th>
                <Th scope="col">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {passkeys.data.map((passkey) => (
                <Tr key={passkey.id}>
                  <Td className="font-medium">{passkey.name || "Passkey"}</Td>
                  <Td>
                    <When at={new Date(passkey.createdAt).toISOString()} />
                  </Td>
                  <Td className="text-right">
                    <RowActions>
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(passkey)}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        aria-label={`Remove ${passkey.name || "passkey"}`}
                        onClick={() => setRemoving(passkey)}
                      >
                        Remove
                      </Button>
                    </RowActions>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
      )}
      {adding ? (
        <NamePasskey
          title="Add a passkey"
          action="Add passkey"
          initial=""
          hint="Such as “MacBook” or “Phone”, so you can tell your passkeys apart. Your device asks you to confirm next."
          onClose={() => setAdding(false)}
          onSave={async (name) => {
            const added = await security.addPasskey(name)
            if (added.failure !== undefined) return added.failure
            setAdding(false)
            props.onToast(`${name} is added. You can sign in with it now.`)
            await reload()
            return undefined
          }}
        />
      ) : null}
      {renaming ? (
        <NamePasskey
          title="Rename passkey"
          action="Rename"
          initial={renaming.name ?? ""}
          onClose={() => setRenaming(undefined)}
          onSave={async (name) => {
            const renamed = await security.renamePasskey(renaming.id, name)
            if (renamed.failure !== undefined) return renamed.failure
            setRenaming(undefined)
            await reload()
            return undefined
          }}
        />
      ) : null}
      {removing ? (
        <Confirm
          title={`Remove ${removing.name || "this passkey"}?`}
          explanation="You won't be able to sign in with it anymore. Your password and other passkeys still work."
          action="Remove"
          onClose={() => setRemoving(undefined)}
          onConfirm={async () => {
            const removed = await security.removePasskey(removing.id)
            if (removed.failure !== undefined) return removed.failure
            setRemoving(undefined)
            props.onToast(`${removing.name || "The passkey"} is removed.`)
            await reload()
            return undefined
          }}
        />
      ) : null}
    </section>
  )
}

/** Runs `work`, keeping its failure on screen and the dialog busy while it runs. */
const useAttempt = () => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserText>()
  const attempt = async (work: () => Attempt) => {
    setBusy(true)
    setError(undefined)
    setError(await work())
    setBusy(false)
  }
  return { busy, error, attempt }
}

function NamePasskey(props: {
  readonly title: string
  readonly action: string
  readonly initial: string
  readonly hint?: string
  readonly onClose: () => void
  readonly onSave: (name: string) => Attempt
}) {
  const [name, setName] = useState(props.initial)
  const { busy, error, attempt } = useAttempt()
  const save = () => void attempt(() => props.onSave(name.trim()))
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || name.trim() === ""} onClick={save}>
            {props.action}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="passkey-name" hint={props.hint ?? "So you can tell your passkeys apart."}>
        <Input
          id="passkey-name"
          maxLength={60}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim() !== "") save()
          }}
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

function Confirm(props: {
  readonly title: string
  readonly explanation: string
  readonly action: string
  readonly onClose: () => void
  readonly onConfirm: () => Attempt
}) {
  const { busy, error, attempt } = useAttempt()
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="danger-solid" disabled={busy} onClick={() => void attempt(props.onConfirm)}>
            {props.action}
          </Button>
        </>
      }
    >
      <p className="m-0 text-muted">{props.explanation}</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

/** A step that needs your password first, as Better-Auth requires for these changes. */
function WithPassword(props: {
  readonly title: string
  readonly explanation: string
  readonly action: string
  readonly danger?: boolean
  readonly onClose: () => void
  readonly onConfirm: (password: string) => Attempt
}) {
  const [password, setPassword] = useState("")
  const { busy, error, attempt } = useAttempt()
  const confirm = () => void attempt(() => props.onConfirm(password))
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant={props.danger ? "danger-solid" : "primary"}
            disabled={busy || password === ""}
            onClick={confirm}
          >
            {props.action}
          </Button>
        </>
      }
    >
      <p className="m-0 text-muted">{props.explanation}</p>
      <Field label="Password" htmlFor="confirm-password">
        <Input
          id="confirm-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && password !== "") confirm()
          }}
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

function ChangePassword(props: {
  readonly context: ReadonlyArray<string>
  readonly onClose: () => void
  readonly onChanged: (signedOutElsewhere: boolean) => Promise<void>
}) {
  const [current, setCurrent] = useState("")
  const [signOutElsewhere, setSignOutElsewhere] = useState(true)
  const [strongEnough, setStrongEnough] = useState(false)
  const onEnough = useCallback((enough: boolean) => setStrongEnough(enough), [])
  const { busy, error, attempt } = useAttempt()
  const change = () =>
    void attempt(async () => {
      const next = (document.getElementById("new-password") as HTMLInputElement | null)?.value ?? ""
      const changed = await security.changePassword(current, next, signOutElsewhere)
      if (changed.failure !== undefined) return changed.failure
      await props.onChanged(signOutElsewhere)
      return undefined
    })
  return (
    <Dialog
      title="Change password"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || current === "" || !strongEnough} onClick={change}>
            Change password
          </Button>
        </>
      }
    >
      <Field label="Current password" htmlFor="current-password">
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>
      <NewPasswordField
        id="new-password"
        name="new-password"
        label="New password"
        context={props.context}
        onEnough={onEnough}
        inDialog
      />
      <Option>
        <Checkbox checked={signOutElsewhere} onChange={(change) => setSignOutElsewhere(change.target.checked)} />
        Sign out everywhere else
      </Option>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

/** The key inside the setup link, for apps that can't scan: grouped in fours to read off. */
const keyOf = (totpURI: string) => (new URL(totpURI).searchParams.get("secret") ?? "").replace(/(.{4})/g, "$1 ").trim()

/**
 * Turning on two-factor authentication (D172): your password, then the app, proven with a code,
 * then the backup codes, shown once.
 */
function TurnOn(props: { readonly onClose: () => void }) {
  const [setup, setSetup] = useState<{ readonly totpURI: string; readonly backupCodes: ReadonlyArray<string> }>()
  const [done, setDone] = useState(false)
  const [code, setCode] = useState("")
  const { busy, error, attempt } = useAttempt()
  if (!setup) {
    return (
      <WithPassword
        title="Turn on two-factor authentication"
        explanation="Enter your password to continue."
        action="Continue"
        onClose={props.onClose}
        onConfirm={async (password) => {
          const started = await security.startTwoFactor(password)
          if (started.failure !== undefined) return started.failure
          setSetup(started.data)
          return undefined
        }}
      />
    )
  }
  if (done) return <BackupCodes codes={setup.backupCodes} onClose={props.onClose} />
  const confirm = () =>
    void attempt(async () => {
      const confirmed = await security.confirmTwoFactor(code)
      if (confirmed.failure !== undefined) return confirmed.failure
      setDone(true)
      return undefined
    })
  return (
    <Dialog
      title="Scan with your authenticator app"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={confirm}>
            Turn on
          </Button>
        </>
      }
    >
      <p className="m-0 text-muted">Use 1Password, Google Authenticator or any app that shows 6-digit codes.</p>
      <div className="self-center rounded-md bg-white p-3">
        <QRCode value={setup.totpURI} size={160} title="QR code to add Parley to your authenticator app" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Can't scan? Enter this key instead.</span>
        <CopyField value={keyOf(setup.totpURI)} label="key" code />
      </div>
      <Field label="Code from the app" htmlFor="totp-code">
        <Input
          id="totp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && code.replace(/\s/g, "").length === 6) confirm()
          }}
        />
      </Field>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Dialog>
  )
}

function NewBackupCodes(props: { readonly onClose: () => void }) {
  const [codes, setCodes] = useState<ReadonlyArray<string>>()
  if (codes) return <BackupCodes codes={codes} onClose={props.onClose} />
  return (
    <WithPassword
      title="Make new backup codes"
      explanation="Your old backup codes stop working."
      action="Make new codes"
      onClose={props.onClose}
      onConfirm={async (password) => {
        const made = await security.newBackupCodes(password)
        if (made.failure !== undefined) return made.failure
        setCodes(made.data.backupCodes)
        return undefined
      }}
    />
  )
}

/** Backup codes, shown once: when two-factor authentication is turned on, and after making new ones. */
function BackupCodes(props: { readonly codes: ReadonlyArray<string>; readonly onClose: () => void }) {
  const [, showToast] = useToast()
  const text = props.codes.join("\n")
  const download = () => {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([`Parley backup codes\n\n${text}\n`], { type: "text/plain" }))
    link.download = "parley-backup-codes.txt"
    link.click()
    URL.revokeObjectURL(link.href)
  }
  return (
    <Dialog
      title="Save your backup codes"
      footer={
        <Button variant="primary" onClick={props.onClose}>
          Done
        </Button>
      }
    >
      <p className="m-0 text-muted">
        If you lose your phone, each of these signs you in once. Keep them in your password manager. You won't see them
        again.
      </p>
      <ul aria-label="Backup codes" className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-fill p-4">
        {props.codes.map((code) => (
          <li key={code} className="font-mono">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => void navigator.clipboard.writeText(text).then(() => showToast("Backup codes copied."))}>
          <CopyIcon />
          Copy
        </Button>
        <Button onClick={download}>
          <DownloadIcon />
          Download
        </Button>
      </div>
      <Hint>Signing in with a passkey never asks for a code.</Hint>
    </Dialog>
  )
}
