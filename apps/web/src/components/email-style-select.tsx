import type { EmailStyleId, TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { call } from "../lib/client.ts"
import { FieldLabel, Hint, Select } from "./ui/index.ts"

/** The team's email styles, shared by every picker so one change refreshes them all. */
export const useEmailStyles = (teamId: TeamId) =>
  useQuery({ queryKey: ["email-styles", teamId], queryFn: () => call("emailStyles.list", { teamId }) })

/**
 * Which email style a template or campaign uses (D117). Null means the team's default, so a later
 * change of default carries through.
 */
export function EmailStyleSelect(props: {
  readonly teamId: TeamId
  readonly value: EmailStyleId | null
  readonly disabled: boolean
  readonly onChange: (styleId: EmailStyleId | null) => void
  readonly hint?: string
}) {
  const styles = useEmailStyles(props.teamId)
  const fallback = styles.data?.find((style) => style.isDefault)
  return (
    <div className="flex min-w-0 flex-col">
      <FieldLabel htmlFor="cmp-style">Email style</FieldLabel>
      <Select
        id="cmp-style"
        disabled={props.disabled}
        value={props.value ?? ""}
        onChange={(event) => props.onChange((event.target.value || null) as EmailStyleId | null)}
      >
        <option value="">Team default{fallback ? ` (${fallback.name})` : ""}</option>
        {(styles.data ?? []).map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}
          </option>
        ))}
      </Select>
      <Hint className="mt-1.5">
        {props.hint ?? (
          <>
            How the email looks.{" "}
            <Link
              className="text-muted underline"
              to="/t/$teamId/settings/email-styles"
              params={{ teamId: props.teamId }}
            >
              Email styles
            </Link>{" "}
            are set up in Settings.
          </>
        )}
      </Hint>
    </div>
  )
}
