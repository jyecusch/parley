import { ROLE_PERMISSIONS, type TeamId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { TemplateIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "../components/ui/breadcrumb.tsx"
import { ItemTile, NameText, nameLinkClass, wideColumnClass } from "../components/ui/email.tsx"
import {
  Button,
  Card,
  Centered,
  Count,
  EmptyState,
  ErrorText,
  PageHeader,
  Spacer,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/templates/")({ component: TemplatesScreen })

const teamRoute = getRouteApi("/t/$teamId")

/** The templates index view (R41): content a new broadcast can start from. */
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
    <Button variant="primary" onClick={() => void create()}>
      New template
    </Button>
  ) : null

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} />}>Templates</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {items.length > 0 ? <Count>{items.length}</Count> : null}
        <Spacer />
        {items.length > 0 ? newButton : null}
      </PageHeader>
      <ViewBody>
        {error ? <ErrorText className="px-4 py-2.5">{error}</ErrorText> : null}
        {templates.isPending ? null : templates.isError ? (
          <LoadFailed
            title="Templates didn't load"
            message={messageOf(templates.error)}
            onRetry={() => void templates.refetch()}
          />
        ) : items.length === 0 ? (
          <Centered>
            <EmptyState icon={<TemplateIcon />} title="No templates yet" actions={newButton}>
              Save the emails you send often as templates. A new broadcast can start from one.
            </EmptyState>
          </Centered>
        ) : (
          <TableScroll>
            <Table>
              <caption className="sr-only">Templates</caption>
              <thead>
                <tr>
                  <Th scope="col" className="pl-4">
                    Name
                  </Th>
                  <Th className={wideColumnClass} scope="col">
                    Subject
                  </Th>
                  <Th className="w-28" scope="col">
                    Updated
                  </Th>
                </tr>
              </thead>
              <tbody>
                {items.map((template) => (
                  <Tr key={template.id}>
                    <Td className="pl-4">
                      <Link
                        className={nameLinkClass}
                        to="/t/$teamId/templates/$templateId"
                        params={{ teamId, templateId: template.id }}
                      >
                        <ItemTile icon={<TemplateIcon className="size-4" />} />
                        <NameText>{template.name}</NameText>
                      </Link>
                    </Td>
                    <Td className={wideColumnClass + (template.subject ? " text-muted" : " text-subtle")}>
                      {template.subject || "No subject"}
                    </Td>
                    <Td className="text-subtle tabular-nums" title={absolute(template.updatedAt)}>
                      {relative(template.updatedAt)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </ViewBody>
    </Card>
  )
}
