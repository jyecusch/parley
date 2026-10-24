import { ROLE_PERMISSIONS, type Submission, type SubmissionStatus, type TeamId } from "@parley/domain"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { useState } from "react"
import { LoadFailed } from "../components/record.tsx"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb.tsx"
import {
  Button,
  Card,
  Centered,
  Hint,
  PageHeader,
  SegmentedControl,
  Spacer,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { call, messageOf } from "../lib/client.ts"
import { cameFrom, conversionOf, formKey, whatHappened } from "../lib/forms.ts"
import { absolute, relative } from "../lib/time.ts"

export const Route = createFileRoute("/t/$teamId/forms/$formId/submissions")({
  validateSearch: (search: Record<string, unknown>): { tab?: "seen-on" } =>
    search.tab === "seen-on" ? { tab: "seen-on" } : {},
  component: SubmissionsScreen,
})

const teamRoute = getRouteApi("/t/$teamId")

type Filter = "all" | SubmissionStatus

const FILTERS = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "waiting", label: "Waiting" },
  { value: "spam", label: "Spam" },
] as const

const TABS = [
  { value: "submissions", label: "Submissions" },
  { value: "seen-on", label: "Seen on" },
] as const

/** A form's submissions (D146): confirmed, waiting for the visitor, and spam with its reason. */
function SubmissionsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const { formId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const canWrite = ROLE_PERMISSIONS[team.role].has("records:write")
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>("all")
  const form = useQuery({
    queryKey: formKey(teamId, formId),
    queryFn: () => call("forms.get", { teamId, formId: formId as never }),
  })
  const submissions = useInfiniteQuery({
    queryKey: [...formKey(teamId, formId), "submissions", filter],
    queryFn: ({ pageParam }) =>
      call("forms.submissions", {
        teamId,
        formId: formId as never,
        limit: 100,
        ...(filter === "all" ? {} : { status: filter }),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = submissions.data?.pages.flatMap((page) => page.items) ?? []
  const counts = form.data?.counts

  const release = async (submission: Submission) => {
    await call("forms.releaseSubmission", { teamId, formId: formId as never, submissionId: submission.id })
    await queryClient.invalidateQueries({ queryKey: formKey(teamId, formId) })
  }

  return (
    <Card as="main" className="grow-999 basis-140">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/t/$teamId/forms" params={{ teamId }} />}>Forms</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/t/$teamId/forms/$formId" params={{ teamId, formId }} />}>
                {form.data?.name ?? "Form"}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage render={(props) => <h1 {...props} />}>Submissions</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Spacer />
      </PageHeader>
      {counts ? (
        <dl className="m-0 grid shrink-0 grid-cols-6 gap-px border-b border-line bg-line max-md:grid-cols-3">
          {(
            [
              ["Views", counts.views.toLocaleString()],
              ["Submitted", counts.submitted.toLocaleString()],
              ["Confirmed", counts.confirmed.toLocaleString()],
              ["Waiting to confirm", counts.waiting.toLocaleString()],
              ["Spam", counts.spam.toLocaleString()],
              ["Conversion", form.data ? conversionOf(form.data) : "—"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3.5">
              <dt className="text-sm text-subtle">{label}</dt>
              <dd className="m-0 text-xl font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5">
        <SegmentedControl
          name="tab"
          label="Show"
          options={TABS}
          value={tab ?? "submissions"}
          onChange={(next) => void navigate({ search: next === "seen-on" ? { tab: "seen-on" } : {}, replace: true })}
        />
        {tab === "seen-on" ? null : (
          <SegmentedControl
            name="filter"
            label="Which submissions"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            className="ml-auto"
          />
        )}
      </div>
      {tab === "seen-on" ? (
        <ViewBody>
          <SeenOn teamId={teamId} formId={formId} />
        </ViewBody>
      ) : (
        <ViewBody>
          {submissions.isPending ? null : submissions.isError ? (
            <Centered>
              <LoadFailed
                title="Submissions didn't load"
                message={messageOf(submissions.error)}
                onRetry={() => void submissions.refetch()}
              />
            </Centered>
          ) : items.length === 0 ? (
            <Centered>
              <Hint>{filter === "all" ? "No submissions yet." : "None here."}</Hint>
            </Centered>
          ) : (
            <TableScroll>
              <Table>
                <caption className="sr-only">Submissions</caption>
                <thead>
                  <tr>
                    <Th scope="col" className="pl-4">
                      Email
                    </Th>
                    <Th scope="col" className="w-40">
                      Name
                    </Th>
                    <Th scope="col" className="w-56">
                      Page
                    </Th>
                    <Th scope="col">Came from</Th>
                    <Th scope="col" className="w-64">
                      What happened
                    </Th>
                    <Th scope="col" className="w-28">
                      Submitted
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((submission) => {
                    const name = [submission.values.firstName, submission.values.lastName]
                      .filter((part): part is string => typeof part === "string" && part !== "")
                      .join(" ")
                    return (
                      <Tr key={submission.id}>
                        <Td className="pl-4">
                          {submission.contactId ? (
                            <Link
                              className="text-fg underline decoration-line-strong underline-offset-3"
                              to="/t/$teamId/contacts"
                              params={{ teamId }}
                              search={{ contact: submission.contactId }}
                            >
                              {submission.email}
                            </Link>
                          ) : (
                            <span className={submission.status === "spam" ? "text-muted" : undefined}>
                              {submission.email}
                            </span>
                          )}
                        </Td>
                        <Td className={name ? undefined : "text-subtle"}>{name || "—"}</Td>
                        <Td className="truncate text-muted">{submission.page || "Hosted page"}</Td>
                        <CameFromCell submission={submission} />
                        <Td>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={
                                submission.status === "spam"
                                  ? "text-warn"
                                  : submission.status === "waiting"
                                    ? "text-muted"
                                    : undefined
                              }
                            >
                              {whatHappened(submission)}
                            </span>
                            {submission.status === "spam" && canWrite ? (
                              <Button size="sm" variant="secondary" onClick={() => void release(submission)}>
                                Release
                              </Button>
                            ) : null}
                          </span>
                        </Td>
                        <Td className="text-subtle tabular-nums" title={absolute(submission.createdAt)}>
                          {relative(submission.createdAt)}
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
              {submissions.hasNextPage ? (
                <div className="p-3">
                  <Button
                    variant="ghost"
                    disabled={submissions.isFetchingNextPage}
                    onClick={() => void submissions.fetchNextPage()}
                  >
                    {submissions.isFetchingNextPage ? "Loading…" : "Show more"}
                  </Button>
                </div>
              ) : null}
            </TableScroll>
          )}
          <Hint className="px-4 py-3">
            Spam is kept for 30 days. Releasing one handles it as a real sign-up, double opt-in included.
          </Hint>
        </ViewBody>
      )}
    </Card>
  )
}

/** Source / medium / campaign, with the other tracking parameters underneath (D153). */
function CameFromCell(props: { readonly submission: Submission }) {
  const shown = cameFrom(props.submission)
  if (!shown) return <Td className="text-subtle">—</Td>
  return (
    <Td className="whitespace-normal text-muted">
      <div>{shown.main}</div>
      {shown.more.length > 0 ? <div className="text-sm text-subtle">{shown.more.join(" · ")}</div> : null}
    </Td>
  )
}

/** Where the form is seen (D144 analytics): views and sign-ups by page, and sign-ups by UTM parameter (D153). */
function SeenOn(props: { readonly teamId: TeamId; readonly formId: string }) {
  const analytics = useQuery({
    queryKey: [...formKey(props.teamId, props.formId), "analytics"],
    queryFn: () => call("forms.analytics", { teamId: props.teamId, formId: props.formId as never }),
  })
  if (analytics.isPending) return null
  if (analytics.isError) {
    return (
      <Centered>
        <LoadFailed
          title="Where it's seen didn't load"
          message={messageOf(analytics.error)}
          onRetry={() => void analytics.refetch()}
        />
      </Centered>
    )
  }
  const { pages, sources, mediums, campaigns } = analytics.data
  if (pages.length === 0) {
    return (
      <Centered>
        <Hint>No views yet.</Hint>
      </Centered>
    )
  }
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-6 p-4">
      <TableScroll className="min-w-0 grow-2 basis-112">
        <Table>
          <caption className="sr-only">Views and sign-ups by page</caption>
          <thead>
            <tr>
              <Th scope="col">Page</Th>
              <Th scope="col" className="w-24 text-right">
                Views
              </Th>
              <Th scope="col" className="w-24 text-right">
                Sign-ups
              </Th>
              <Th scope="col" className="w-28 text-right">
                Conversion
              </Th>
            </tr>
          </thead>
          <tbody>
            {pages.map((entry) => (
              <Tr key={entry.page}>
                <Td className="truncate">{entry.page || "Hosted page (link)"}</Td>
                <Td className="text-right tabular-nums">{entry.views.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{entry.confirmed.toLocaleString()}</Td>
                <Td className="text-right text-muted tabular-nums">
                  {entry.views > 0 ? `${((entry.confirmed / entry.views) * 100).toFixed(1)}%` : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      {sources.length > 0 ? (
        <dl className="m-0 flex grow basis-72 flex-col gap-2 text-sm">
          {(
            [
              ["utm_source", sources],
              ["utm_medium", mediums],
              ["utm_campaign", campaigns],
            ] as const
          ).map(([parameter, counts]) => (
            <div key={parameter} className="flex gap-4">
              <dt className="w-28 shrink-0 font-mono text-subtle">{parameter}</dt>
              <dd className="m-0 min-w-0 text-muted">
                {counts.map((entry) => `${entry.value || "(none)"} ${entry.confirmed}`).join(" · ")}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
