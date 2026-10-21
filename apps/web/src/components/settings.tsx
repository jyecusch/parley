import type { Permission, Team } from "@parley/domain"
import type { UserText } from "@parley/errors"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { relative } from "../lib/time.ts"
import { useCrt } from "./crt.tsx"
import {
  AlertIcon,
  BackIcon,
  CheckIcon,
  ConnectionIcon,
  CopyIcon,
  DisplayIcon,
  KeyIcon,
  MailIcon,
  MembersIcon,
  PaletteIcon,
  ServiceAccountIcon,
  SettingsIcon,
} from "./icons.tsx"
import {
  Box,
  Breadcrumb,
  BreadcrumbSeparator,
  Button,
  Card,
  CodeTag,
  cn,
  Dialog,
  EmptyState,
  IconButton,
  NavIcon,
  NavLabel,
  PageHeader,
  PortalContainer,
  Skeleton,
  showToast,
  Table,
  Td,
  Tr,
} from "./ui/index.ts"
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  sidebarMenuButtonActiveClass,
} from "./ui/sidebar.tsx"
import { Toaster } from "./ui/sonner.tsx"

/** What each scope lets a key or connection do, in the words the dialogs use. */
export const SCOPE_LABELS: Readonly<Record<Permission, string>> = {
  "records:read": "See contacts and companies",
  "records:write": "Create and edit them",
  "records:delete": "Delete and restore them",
  "fields:manage": "Manage custom fields",
  "members:manage": "Manage members",
  "service-accounts:manage": "Manage service accounts",
  "team:manage": "Manage the team",
  "email:write": "Write campaigns, templates and segments",
  "email:send": "Send campaigns",
  "email:manage": "Manage email settings",
}

/** Short scope names for lists: "records:write" → "write", "fields:manage" → "fields". */
const shortScope = (scope: Permission) =>
  scope.startsWith("records:") ? scope.slice(8) : scope.startsWith("email:") ? scope : scope.split(":")[0]

export const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase()
  const word = words[0] ?? "?"
  return `${word[0]?.toUpperCase() ?? ""}${word[1] ?? ""}`
}

/** "3d ago", or the fallback for something that hasn't happened. The full time is in the title. */
export function When(props: { readonly at: string | null; readonly never?: string }) {
  if (!props.at) return <span className="text-subtle tabular-nums">{props.never ?? "Never"}</span>
  const short = relative(props.at)
  return (
    <span className="text-subtle tabular-nums" title={new Date(props.at).toLocaleString()}>
      {short === "now" ? "Just now" : `${short} ago`}
    </span>
  )
}

const SETTINGS_PAGES = [
  { group: "team", to: "/t/$teamId/settings/general", label: "General", icon: <SettingsIcon /> },
  { group: "team", to: "/t/$teamId/settings/members", label: "Members", icon: <MembersIcon /> },
  { group: "team", to: "/t/$teamId/settings/fields", label: "Fields", icon: <DisplayIcon className="size-5" /> },
  { group: "team", to: "/t/$teamId/settings/email", label: "Email", icon: <MailIcon /> },
  { group: "team", to: "/t/$teamId/settings/email-styles", label: "Email styles", icon: <PaletteIcon /> },
  {
    group: "team",
    to: "/t/$teamId/settings/service-accounts",
    label: "Service accounts",
    icon: <ServiceAccountIcon />,
  },
  { group: "you", to: "/t/$teamId/settings/connections", label: "Connections", icon: <ConnectionIcon /> },
  { group: "you", to: "/t/$teamId/settings/api-keys", label: "API keys", icon: <KeyIcon /> },
] as const

/**
 * Settings replace the app sidebar with their own, with a way back (D90).
 */
export function SettingsShell(props: { readonly team: Team; readonly children: ReactNode }) {
  const params = { teamId: props.team.id }
  const crt = useCrt()
  const links = (group: "team" | "you") =>
    SETTINGS_PAGES.filter((page) => page.group === group).map((page) => (
      <SidebarMenuItem key={page.to}>
        <SidebarMenuButton
          render={
            <Link
              activeProps={{ className: sidebarMenuButtonActiveClass, "aria-current": "page" }}
              to={page.to}
              params={params}
            />
          }
        >
          <NavIcon>{page.icon}</NavIcon>
          <NavLabel>{page.label}</NavLabel>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ))
  return (
    <>
      <div ref={crt.screenRef} className="relative flex h-dvh w-full overflow-hidden">
        <PortalContainer.Provider value={crt.screen}>
          {/* Settings' sidebar doesn't collapse. */}
          <SidebarProvider open>
            <Sidebar aria-label="Settings">
              <SidebarMenuButton
                className="mb-3"
                render={<Link to="/t/$teamId/contacts" params={params} search={{}} />}
              >
                <NavIcon>
                  <BackIcon />
                </NavIcon>
                <NavLabel>Back to Contacts</NavLabel>
              </SidebarMenuButton>
              <SidebarGroup>
                <SidebarGroupLabel>{props.team.name}</SidebarGroupLabel>
                <SidebarMenu>{links("team")}</SidebarMenu>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>You</SidebarGroupLabel>
                <SidebarMenu>{links("you")}</SidebarMenu>
              </SidebarGroup>
            </Sidebar>
          </SidebarProvider>
          <div className="@container/content relative flex min-w-0 flex-[999_1_35rem] gap-1.5 py-1.5 pr-1.5">
            {props.children}
          </div>
          <Toaster />
        </PortalContainer.Provider>
      </div>
      {crt.overlay}
    </>
  )
}

export function SettingsPage(props: {
  readonly title: string
  readonly intro: ReactNode
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Card as="main" className="flex-1">
      <PageHeader>
        <Breadcrumb>
          <span className="text-muted">Settings</span>
          <BreadcrumbSeparator />
          <span>{props.title}</span>
        </Breadcrumb>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex max-w-6xl flex-col gap-6 px-10 pt-8 pb-16 @max-3xl/content:px-5">
          {/* The page's main action sits beside its title, next to what it acts on, not at the window's edge. */}
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 mb-1 text-lg font-semibold tracking-tight">{props.title}</h2>
              <p className="m-0 max-w-3xl text-pretty text-muted">{props.intro}</p>
            </div>
            {props.action ? <div className="flex shrink-0 gap-1.5">{props.action}</div> : null}
          </div>
          {props.children}
        </div>
      </div>
    </Card>
  )
}

/** A read-only value with its copy button inside the field (D97). */
export function CopyField(props: { readonly value: string; readonly label: string; readonly code?: boolean }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    await navigator.clipboard.writeText(props.value)
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className={cn("relative flex min-w-0 rounded-md bg-fill", props.code ? "items-start" : "h-10 items-center")}>
      <output
        className={cn(
          "min-w-0 flex-1 font-mono text-sm",
          props.code
            ? "overflow-auto py-2.5 pr-1 pl-3 leading-6 whitespace-pre select-text"
            : "truncate pr-1 pl-3 select-all",
        )}
        aria-label={props.label}
      >
        {props.value}
      </output>
      <IconButton
        label={copied ? `Copied ${props.label}` : `Copy ${props.label}`}
        tip={copied ? "Copied" : "Copy"}
        className={cn("mr-1", props.code && "mt-1")}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </IconButton>
    </div>
  )
}

export function ScopeChips(props: { readonly scopes: ReadonlyArray<Permission> }) {
  return (
    <span className="flex flex-nowrap gap-1">
      {props.scopes.map((scope) => (
        <span key={scope} title={scope}>
          <CodeTag>{shortScope(scope)}</CodeTag>
        </span>
      ))}
    </span>
  )
}

/** Revoke with an inline confirmation in the row. There's no undo, so it asks once. */
export function RevokeButton(props: { readonly name: string; readonly onRevoke: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!confirming) {
    return (
      <Button size="sm" variant="danger" aria-label={`Revoke ${props.name}`} onClick={() => setConfirming(true)}>
        Revoke
      </Button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="danger-solid"
        disabled={busy}
        aria-label={`Confirm: revoke ${props.name}`}
        onClick={async () => {
          setBusy(true)
          await props.onRevoke()
          setBusy(false)
          setConfirming(false)
        }}
      >
        Revoke
      </Button>
    </span>
  )
}

export { Dialog }

/**
 * Shows a toast (D139: sonner, through showToast). Kept as a hook for the settings pages: the first
 * value is always null now, as the Toaster in SettingsShell draws the toast.
 */
export const useToast = () => [null, (text: string) => void showToast(text)] as const

export function LoadingRows() {
  const rows = [
    { a: "w-[55%]", b: "w-[35%]", c: "w-[60%]" },
    { a: "w-[45%]", b: "w-[40%]", c: "w-[75%]" },
    { a: "w-[65%]", b: "w-[30%]", c: "w-[55%]" },
  ]
  return (
    <Box role="status" aria-label="Loading">
      <Table kind="settings">
        <tbody>
          {rows.map((row) => (
            <Tr key={row.a}>
              <Td className="w-[27%]">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-7 shrink-0 rounded-md" />
                  <span className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className={row.a} />
                    <Skeleton className={row.b} />
                  </span>
                </div>
              </Td>
              <Td className="w-[17%]">
                <Skeleton className={row.c} />
              </Td>
              <Td className="w-[19%]">
                <Skeleton className="w-[70%]" />
              </Td>
              <Td>
                <Skeleton className="w-16" />
              </Td>
              <Td>
                <Skeleton className="w-14" />
              </Td>
              <Td className="w-44" />
            </Tr>
          ))}
        </tbody>
      </Table>
    </Box>
  )
}

export function LoadFailed(props: {
  readonly title: string
  readonly message: UserText
  readonly onRetry: () => void
}) {
  return (
    <Box className="grid place-items-center px-6 py-12" role="alert">
      <EmptyState
        tone="danger"
        icon={<AlertIcon />}
        title={props.title}
        actions={
          <Button variant="primary" onClick={props.onRetry}>
            Try again
          </Button>
        }
      >
        {props.message}
      </EmptyState>
    </Box>
  )
}

export function Empty(props: { readonly icon: ReactNode; readonly title: string; readonly children: ReactNode }) {
  return (
    <Box className="grid place-items-center px-6 py-12">
      <EmptyState icon={props.icon} title={props.title}>
        {props.children}
      </EmptyState>
    </Box>
  )
}
