import { ROLE_PERMISSIONS, type Submission, type SubmissionStatus, type TeamId } from "@parley/domain"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { FormIcon } from "../components/icons.tsx"
import { LoadFailed } from "../components/record.tsx"
import { LoadingRows } from "../components/settings.tsx"
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
  buttonClass,
  Card,
  Centered,
  EmptyState,
  InfoTip,
  PageHeader,
  SegmentedControl,
  Spacer,
  showToast,
  Table,
  TableScroll,
  Td,
  Th,
  Tr,
  ViewBody,
} from "../components/ui/index.ts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import { call, messageOf } from "../lib/client.ts"
import { cameFrom, conversionOf, formKey, whatHappened } from "../lib/forms.ts"
import { absolute, relative } from "../lib/time.ts"

type Filter = "all" | SubmissionStatus

const FILTERS = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "waiting", label: "Waiting" },
  { value: "expired", label: "Expired" },
  { value: "spam", label: "Spam" },
] as const

/** The open tab and filter, in the address so a refresh or a shared link keeps them. */
export interface SubmissionsSearch {
  readonly tab?: "seen-on"
  readonly status?: SubmissionStatus
}

export const Route = createFileRoute("/t/$teamId/forms/$formId/submissions")({
  validateSearch: (search: Record<string, unknown>): SubmissionsSearch => ({
    ...(search.tab === "seen-on" ? { tab: "seen-on" as const } : {}),
    ...(FILTERS.some((filter) => filter.value !== "all" && filter.value === search.status)
      ? { status: search.status as SubmissionStatus }
      : {}),
  }),
  component: SubmissionsScreen,
})

const teamRoute = getRouteApi("/t/$teamId")

/** A form's submissions (D146): confirmed, waiting for the visitor, and spam with its reason. */
function SubmissionsScreen() {
  const { team } = teamRoute.useLoaderData()
  const teamId = team.id as TeamId
  const { formId } = Route.useParams()
  const { tab, status } = Route.useSearch()
  const filter: Filter = status ?? "all"
  const navigate = Route.useNavigate()
  const canWrite = ROLE_PERMISSIONS[team.role].has("records:write")
  const queryClient = useQueryClient()
  const [releasing, setReleasing] = useState<string>()
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
    if (releasing) return
    setReleasing(submission.id)
    try {
      await call("forms.releaseSubmission", { teamId, formId: formId as never, submissionId: submission.id })
      await queryClient.invalidateQueries({ queryKey: formKey(teamId, formId) })
      showToast(`Released ${submission.email}`)
    } catch (failure) {
      showToast(messageOf(failure))
    }
    setReleasing(undefined)
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
              ["Waiting", counts.waiting.toLocaleString()],
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
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={tab ?? "submissions"}
        onValueChange={(next) =>
          void navigate({ search: next === "seen-on" ? { tab: "seen-on" } : status ? { status } : {}, replace: true })
        }
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5">
          <TabsList>
            <TabsTrigger value="submissions">Submissions</TabsTrigger>
            <TabsTrigger value="seen-on">Seen on</TabsTrigger>
          </TabsList>
          {tab === "seen-on" ? null : (
            <div className="ml-auto flex items-center gap-1.5">
              <SegmentedControl
                name="filter"
                label="Which submissions"
                options={FILTERS}
                value={filter}
                onChange={(next) => void navigate({ search: next === "all" ? {} : { status: next }, replace: true })}
              />
              <InfoTip label="spam and expired submissions">
                Spam is kept for 30 days; releasing one handles it as if just sent, double opt-in included. A submission
                not confirmed within 7 days expires, and its answers go.
              </InfoTip>
            </div>
          )}
        </div>
        <TabsContent value="seen-on" className="flex min-h-0 flex-1 flex-col">
          <ViewBody>
            <SeenOn teamId={teamId} formId={formId} />
          </ViewBody>
        </TabsContent>
        <TabsContent value="submissions" className="flex min-h-0 flex-1 flex-col">
          <ViewBody>
            {submissions.isPending ? (
              <LoadingRows />
            ) : submissions.isError ? (
              <Centered>
                <LoadFailed
                  title="Submissions didn't load"
                  message={messageOf(submissions.error)}
                  onRetry={() => void submissions.refetch()}
                />
              </Centered>
            ) : items.length === 0 ? (
              <Centered>
                {filter === "all" ? (
                  <EmptyState
                    icon={<FormIcon />}
                    title="No submissions yet"
                    actions={
                      <Link
                        className={buttonClass({ variant: "secondary" })}
                        to="/t/$teamId/forms/$formId"
                        params={{ teamId, formId }}
                        search={{ tab: "embed" }}
                      >
                        Embed the form
                      </Link>
                    }
                  >
                    Submissions show here as visitors send them.
                  </EmptyState>
                ) : (
                  <EmptyState icon={<FormIcon />} title={`No ${FILTER_NAMES[filter]} submissions`} />
                )}
              </Centered>
            ) : (
              <SubmissionsTable
                teamId={teamId}
                items={items}
                canWrite={canWrite}
                releasing={releasing}
                onRelease={(submission) => void release(submission)}
                more={
                  submissions.hasNextPage ? (
                    <div className="p-3">
                      <Button
                        variant="ghost"
                        disabled={submissions.isFetchingNextPage}
                        onClick={() => void submissions.fetchNextPage()}
                      >
                        {submissions.isFetchingNextPage ? "Loading…" : "Show more"}
                      </Button>
                    </div>
                  ) : null
                }
              />
            )}
          </ViewBody>
        </TabsContent>
      </Tabs>
    </Card>
  )
}

const FILTER_NAMES: Readonly<Record<SubmissionStatus, string>> = {
  confirmed: "confirmed",
  waiting: "waiting",
  expired: "expired",
  spam: "spam",
}

function SubmissionsTable(props: {
  readonly teamId: TeamId
  readonly items: ReadonlyArray<Submission>
  readonly canWrite: boolean
  readonly releasing: string | undefined
  readonly onRelease: (submission: Submission) => void
  readonly more: ReactNode
}) {
  const { teamId } = props
  return (
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
          {props.items.map((submission) => {
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
                    <span className={submission.status === "spam" ? "text-muted" : undefined}>{submission.email}</span>
                  )}
                </Td>
                <Td className={name ? undefined : "text-subtle"}>{name || "—"}</Td>
                <Td className="truncate text-muted">{submission.page || "Hosted page"}</Td>
                <CameFromCell submission={submission} />
                <Td className="whitespace-normal">
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={
                        submission.status === "spam"
                          ? "text-warn"
                          : submission.status === "waiting" || submission.status === "expired"
                            ? "text-muted"
                            : undefined
                      }
                    >
                      {whatHappened(submission)}
                    </span>
                    {submission.status === "spam" && props.canWrite ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={props.releasing !== undefined}
                        onClick={() => props.onRelease(submission)}
                      >
                        {props.releasing === submission.id ? "Releasing…" : "Release"}
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
      {props.more}
    </TableScroll>
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

/** Where the form is seen (D144 analytics): views and confirmed submissions by page, and by UTM parameter (D153). */
function SeenOn(props: { readonly teamId: TeamId; readonly formId: string }) {
  const analytics = useQuery({
    queryKey: [...formKey(props.teamId, props.formId), "analytics"],
    queryFn: () => call("forms.analytics", { teamId: props.teamId, formId: props.formId as never }),
  })
  if (analytics.isPending) return <LoadingRows />
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
        <EmptyState icon={<FormIcon />} title="Not seen yet">
          Pages show here once the form has been viewed on them.
        </EmptyState>
      </Centered>
    )
  }
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-6 p-4">
      <TableScroll className="min-w-0 grow-2 basis-112">
        <Table>
          <caption className="sr-only">Views and confirmed submissions by page</caption>
          <thead>
            <tr>
              <Th scope="col">Page</Th>
              <Th scope="col" className="w-24 text-right">
                Views
              </Th>
              <Th scope="col" className="w-24 text-right">
                Confirmed
              </Th>
              <Th scope="col" className="w-28 text-right">
                Conversion
              </Th>
            </tr>
          </thead>
          <tbody>
            {pages.map((entry) => (
              <Tr key={entry.page}>
                <Td className="truncate">{entry.page || "Hosted page"}</Td>
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
        <section className="flex grow basis-72 flex-col gap-2">
          <h2 className="m-0 text-sm font-normal text-subtle">Confirmed submissions by UTM parameter</h2>
          <dl className="m-0 flex flex-col gap-2 text-sm">
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
                  {counts.map((entry) => `${entry.value || "(none)"}: ${entry.confirmed.toLocaleString()}`).join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  )
}
