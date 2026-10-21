import { type EmailStyle, ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useEmailStyles } from "../components/email-style-select.tsx"
import { InfoIcon, PaletteIcon } from "../components/icons.tsx"
import { Empty, LoadFailed, LoadingRows, SettingsPage, useToast } from "../components/settings.tsx"
import {
  Badge,
  Box,
  Button,
  buttonClass,
  CodeTag,
  cn,
  Hint,
  Notice,
  Table,
  Td,
  Th,
  Tr,
} from "../components/ui/index.ts"
import { RowActions } from "../components/ui/settings-extra.tsx"
import { call, messageOf } from "../lib/client.ts"

export const Route = createFileRoute("/t/$teamId/settings/email-styles/")({ component: EmailStyles })

const team = getRouteApi("/t/$teamId")

const usedBy = (style: EmailStyle) => {
  const parts = [
    style.usedBy.templates > 0
      ? `${style.usedBy.templates} ${style.usedBy.templates === 1 ? "template" : "templates"}`
      : null,
    style.usedBy.broadcasts > 0
      ? `${style.usedBy.broadcasts} ${style.usedBy.broadcasts === 1 ? "broadcast" : "broadcasts"}`
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "Not used yet"
}

const DESCRIPTIONS: Readonly<Record<EmailStyle["layout"], string>> = {
  plain: "Plain, like a personal email",
  card: "A card on a coloured background",
  custom: "Your own HTML around the content",
}

/** The team's email styles (D116): how its emails look. */
function EmailStyles() {
  const { team: current } = team.useLoaderData()
  const teamId = current.id as TeamId
  const canManage = ROLE_PERMISSIONS[current.role].has("email:manage")
  const queryClient = useQueryClient()
  const [toast, showToast] = useToast()
  const styles = useEmailStyles(teamId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["email-styles", teamId] })
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work()
      await refresh()
      showToast(done)
    } catch (failure) {
      showToast(messageOf(failure))
    }
  }

  return (
    <SettingsPage
      title="Email styles"
      intro="How your emails look: logo, colours, font and layout. Templates and broadcasts use the default unless they choose another."
      action={
        canManage ? (
          <Link
            className={buttonClass({ variant: "primary" })}
            to="/t/$teamId/settings/email-styles/$styleId"
            params={{ teamId, styleId: "new" }}
          >
            New email style
          </Link>
        ) : undefined
      }
    >
      {canManage ? null : <Notice icon={<InfoIcon />}>Only admins and owners can change email styles.</Notice>}
      {styles.isPending ? (
        <LoadingRows />
      ) : styles.isError ? (
        <LoadFailed
          title="Email styles didn't load"
          message={messageOf(styles.error)}
          onRetry={() => void styles.refetch()}
        />
      ) : styles.data.length === 0 ? (
        <Empty icon={<PaletteIcon />} title="No email styles yet">
          Emails use the plain look until you make one.
        </Empty>
      ) : (
        <Box>
          <Table kind="settings">
            <thead>
              <tr>
                <Th scope="col" className="w-36">
                  Looks like
                </Th>
                <Th scope="col">Name</Th>
                <Th scope="col" className="w-48">
                  Used by
                </Th>
                <Th scope="col" className="w-64">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {styles.data.map((style) => (
                <Tr key={style.id}>
                  <Td className="h-24">
                    <StyleThumbnail style={style} />
                  </Td>
                  <Td className="whitespace-normal">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-medium">
                        <Link
                          className="truncate text-fg no-underline hover:underline"
                          to="/t/$teamId/settings/email-styles/$styleId"
                          params={{ teamId, styleId: style.id }}
                        >
                          {style.name}
                        </Link>
                        {style.isDefault ? <Badge tone="strong">Default</Badge> : null}
                        {style.layout === "custom" ? <CodeTag>Custom HTML</CodeTag> : null}
                      </span>
                      <span className="text-sm text-subtle">{DESCRIPTIONS[style.layout]}</span>
                    </div>
                  </Td>
                  <Td className="text-muted">{usedBy(style)}</Td>
                  <Td className="text-right">
                    {canManage ? (
                      <StyleActions
                        style={style}
                        onSetDefault={() =>
                          void act(
                            () => call("emailStyles.setDefault", { teamId, styleId: style.id }),
                            `${style.name} is now the default.`,
                          )
                        }
                        onDelete={() =>
                          act(
                            () => call("emailStyles.delete", { teamId, styleId: style.id }),
                            `${style.name} is deleted.`,
                          )
                        }
                        teamId={teamId}
                      />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Box>
      )}
      <Hint>
        A style that templates or draft broadcasts use can't be deleted until they choose another. Sent broadcasts keep
        the look they were sent with.
      </Hint>
      {toast}
    </SettingsPage>
  )
}

function StyleActions(props: {
  readonly teamId: TeamId
  readonly style: EmailStyle
  readonly onSetDefault: () => void
  readonly onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (confirming) {
    return (
      <RowActions>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="danger-solid"
          disabled={busy}
          aria-label={`Confirm: delete ${props.style.name}`}
          onClick={async () => {
            setBusy(true)
            await props.onDelete()
            setBusy(false)
            setConfirming(false)
          }}
        >
          Delete
        </Button>
      </RowActions>
    )
  }
  return (
    <RowActions>
      {props.style.isDefault ? null : (
        <Button size="sm" variant="ghost" onClick={props.onSetDefault}>
          Make default
        </Button>
      )}
      <Link
        className={buttonClass({ variant: "ghost", size: "sm" })}
        to="/t/$teamId/settings/email-styles/$styleId"
        params={{ teamId: props.teamId, styleId: props.style.id }}
      >
        Edit
      </Link>
      {props.style.isDefault ? null : (
        <Button
          size="sm"
          variant="danger"
          aria-label={`Delete ${props.style.name}`}
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}
    </RowActions>
  )
}

/**
 * A small sketch of a style, in its own colours: lines of text, a button, and the footer rule. Colours
 * are the team's data, so they're set inline.
 */
export function StyleThumbnail(props: { readonly style: Pick<EmailStyle, "layout" | "colors" | "logoUrl"> }) {
  const { layout, colors } = props.style
  if (layout === "custom") {
    return (
      <div
        aria-hidden="true"
        className="flex h-16 w-24 flex-col gap-1 rounded-md bg-[#15171c] p-2 font-mono text-2xs text-[#9aa3b5] [text-shadow:none]"
      >
        <span>&lt;html&gt;</span>
        <span className="h-1 w-4/5 rounded-full bg-[#3a3f4b]" />
        <span className="text-[#e3b341]">{"{{content}}"}</span>
      </div>
    )
  }
  const lines = (
    <>
      {props.style.logoUrl ? (
        <img src={props.style.logoUrl} alt="" className="h-2.5 w-auto self-start object-contain" />
      ) : null}
      <span className="h-1 w-4/5 rounded-full opacity-80" style={{ background: colors.text }} />
      <span className="h-1 w-3/5 rounded-full opacity-40" style={{ background: colors.text }} />
      <span className="mt-0.5 h-2 w-2/5 rounded-sm" style={{ background: colors.button }} />
    </>
  )
  return layout === "card" ? (
    <div
      aria-hidden="true"
      className="h-16 w-24 rounded-md p-1.5 inset-ring inset-ring-line"
      style={{ background: colors.background }}
    >
      <div className="flex h-full flex-col gap-1 rounded-sm bg-white p-1.5">{lines}</div>
    </div>
  ) : (
    <div
      aria-hidden="true"
      className={cn("flex h-16 w-24 flex-col gap-1 rounded-md p-2 inset-ring inset-ring-line")}
      style={{ background: colors.background }}
    >
      {lines}
      <span className="mt-auto h-px opacity-20" style={{ background: colors.text }} />
    </div>
  )
}
