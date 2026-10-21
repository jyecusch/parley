import type { Team, TeamId } from "@parley/domain"
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import {
  applyTheme,
  crtEnabled,
  setCrt,
  setSidebarCollapsed,
  sidebarCollapsed,
  type ThemeChoice,
  themeChoice,
} from "../lib/appearance.ts"
import { signOut } from "../lib/auth.ts"
import { companyApi, primaryDomainOf } from "../lib/companies.ts"
import { contactApi } from "../lib/contacts.ts"
import { MY_CONTACTS_VIEW, useSavedViews } from "../lib/index-view.ts"
import { useRecordSearch } from "../lib/records.ts"
import { useCrt } from "./crt.tsx"
import { CrtSettingsDialog } from "./crt-settings.tsx"
import {
  ChevronDown,
  CloseIcon,
  CompaniesIcon,
  ContactsIcon,
  PlusIcon,
  RestoreIcon,
  SearchIcon,
  SegmentIcon,
  SendIcon,
  SettingsIcon,
  SidebarIcon,
  SwitchIcon,
  TemplateIcon,
  TuneIcon,
} from "./icons.tsx"
import { CompanyLogo, ContactAvatar } from "./images.tsx"
import { PendingInvitations, usePendingInvitations } from "./pending-invitations.tsx"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx"
import { Avatar, cn, IconButton, Kbd, NavIcon, NavLabel, PortalContainer } from "./ui/index.ts"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  sidebarMenuButtonActiveClass,
} from "./ui/sidebar.tsx"
import { Toaster } from "./ui/sonner.tsx"

interface Shell {
  readonly team: Team
  readonly teams: ReadonlyArray<Team>
  readonly openCommand: () => void
}

const ShellContext = createContext<Shell | null>(null)

export const useShell = (): Shell => {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error("useShell must be used inside the app shell")
  return shell
}

/** True when a key press belongs to a text field rather than to a shortcut. */
export const isTyping = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null
  return Boolean(target?.closest("input, textarea, select, [contenteditable=true]"))
}

export function AppShell(props: {
  readonly team: Team
  readonly teams: ReadonlyArray<Team>
  readonly userName: string
  readonly children: ReactNode
}) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(sidebarCollapsed)
  const [commandOpen, setCommandOpen] = useState(false)
  const [teamMenu, setTeamMenu] = useState(false)
  const [crtSettingsOpen, setCrtSettingsOpen] = useState(false)
  // Invitations waiting for this person, shown in the team menu (D131).
  const invitations = usePendingInvitations().data ?? []
  const crt = useCrt()
  const closeTeamMenu = useCallback(() => setTeamMenu(false), [])

  // The sidebar's open state is kept per browser (parley.sidebar); ⌘\ toggles it.
  const onSidebarOpenChange = useCallback((open: boolean) => {
    setCollapsed(!open)
    setSidebarCollapsed(!open)
  }, [])

  // "New" means a record of the type on screen: a company on Companies, otherwise a contact.
  const matchRoute = useMatchRoute()
  const onCompanies = Boolean(matchRoute({ to: "/t/$teamId/companies", fuzzy: true }))
  const newRecord = useCallback(
    () =>
      onCompanies
        ? navigate({ to: "/t/$teamId/companies", params: { teamId: props.team.id }, search: { new: true } })
        : navigate({ to: "/t/$teamId/contacts", params: { teamId: props.team.id }, search: { new: true } }),
    [navigate, onCompanies, props.team.id],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setCommandOpen((open) => !open)
        return
      }
      if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "c" && !commandOpen) {
        event.preventDefault()
        void newRecord()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [commandOpen, newRecord])

  const savedViews = useSavedViews(props.team.id as TeamId).data ?? []

  const shell = useMemo<Shell>(
    () => ({ team: props.team, teams: props.teams, openCommand: () => setCommandOpen(true) }),
    [props.team, props.teams],
  )

  const initials = props.userName
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const teamId = props.team.id
  const activeProps = { className: sidebarMenuButtonActiveClass }
  const savedViewItems = (recordType: "contact" | "company") =>
    savedViews
      .filter((view) => view.recordType === recordType)
      .map((view) => (
        <SidebarMenuItem key={view.id}>
          <SidebarMenuButton
            size="sm"
            tooltip={view.name}
            render={
              <Link
                activeProps={activeProps}
                activeOptions={{ includeSearch: true }}
                to={recordType === "contact" ? "/t/$teamId/contacts" : "/t/$teamId/companies"}
                params={{ teamId }}
                search={{ view: view.id }}
              />
            }
          >
            <NavIcon>
              <span className="size-1.5 rounded-full bg-current opacity-60" />
            </NavIcon>
            <NavLabel collapsed={collapsed}>{view.name}</NavLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))

  return (
    <ShellContext.Provider value={shell}>
      <div ref={crt.screenRef} className="relative flex h-dvh w-full overflow-hidden">
        <PortalContainer.Provider value={crt.screen}>
          <SidebarProvider open={!collapsed} onOpenChange={onSidebarOpenChange} shortcut={"\\"}>
            <Sidebar aria-label="Main">
              <SidebarHeader>
                <div className={cn("relative flex min-w-0", collapsed ? "w-full" : "flex-1")}>
                  <DropdownMenu modal={false} open={teamMenu} onOpenChange={setTeamMenu}>
                    <DropdownMenuTrigger
                      className={cn(
                        "flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1.5 font-medium hover:bg-hover",
                        collapsed && "justify-center px-0",
                      )}
                      aria-label={`Switch team (current: ${props.team.name})${invitations.length > 0 ? `, ${invitations.length} pending ${invitations.length === 1 ? "invitation" : "invitations"}` : ""}`}
                    >
                      <span className="relative">
                        <TeamLogo name={props.team.name} />
                        {invitations.length > 0 ? (
                          <span
                            aria-hidden="true"
                            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-focus ring-2 ring-canvas"
                          />
                        ) : null}
                      </span>
                      <NavLabel collapsed={collapsed}>{props.team.name}</NavLabel>
                      {collapsed ? null : <ChevronDown className="text-subtle" />}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Teams</DropdownMenuLabel>
                        {props.teams.map((team) => (
                          <DropdownMenuLinkItem
                            key={team.id}
                            active={team.id === props.team.id}
                            render={<Link to="/t/$teamId/contacts" params={{ teamId: team.id }} />}
                          >
                            <TeamLogo name={team.name} />
                            {team.name}
                          </DropdownMenuLinkItem>
                        ))}
                      </DropdownMenuGroup>
                      {invitations.length > 0 ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Invitations</DropdownMenuLabel>
                            <div className="w-80">
                              <PendingInvitations
                                compact
                                invitations={invitations}
                                onJoined={(team) => {
                                  closeTeamMenu()
                                  void navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: {} })
                                }}
                              />
                            </div>
                          </DropdownMenuGroup>
                        </>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuLinkItem render={<Link to="/new-team" />}>
                        <NavIcon>
                          <PlusIcon className="size-4" />
                        </NavIcon>
                        New team
                      </DropdownMenuLinkItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <IconButton label="Search" tip="Search  ⌘K" onClick={() => setCommandOpen(true)}>
                  <SearchIcon />
                </IconButton>
                {collapsed ? null : (
                  <IconButton
                    label={onCompanies ? "New company" : "New contact"}
                    tip={onCompanies ? "New company  C" : "New contact  C"}
                    onClick={() => void newRecord()}
                  >
                    <PlusIcon />
                  </IconButton>
                )}
                <IconButton
                  label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  tip={`${collapsed ? "Expand" : "Collapse"} sidebar  ⌘\\`}
                  className={cn(
                    !collapsed &&
                      "opacity-0 group-hover/side:opacity-100 focus-visible:opacity-100 transition-opacity motion-reduce:transition-none",
                  )}
                  onClick={() => onSidebarOpenChange(collapsed)}
                >
                  <SidebarIcon />
                </IconButton>
              </SidebarHeader>

              <SidebarContent>
                <SidebarGroup>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Contacts"
                        render={
                          <Link activeProps={activeProps} to="/t/$teamId/contacts" params={{ teamId }} search={{}} />
                        }
                      >
                        <NavIcon>
                          <ContactsIcon />
                        </NavIcon>
                        <NavLabel collapsed={collapsed}>Contacts</NavLabel>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        size="sm"
                        tooltip="My contacts"
                        render={
                          <Link
                            activeProps={activeProps}
                            activeOptions={{ includeSearch: true }}
                            to="/t/$teamId/contacts"
                            params={{ teamId }}
                            search={{ view: MY_CONTACTS_VIEW }}
                          />
                        }
                      >
                        <NavIcon>
                          <span className="size-1.5 rounded-full bg-current opacity-60" />
                        </NavIcon>
                        <NavLabel collapsed={collapsed}>My contacts</NavLabel>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {savedViewItems("contact")}
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Companies"
                        render={
                          <Link activeProps={activeProps} to="/t/$teamId/companies" params={{ teamId }} search={{}} />
                        }
                      >
                        <NavIcon>
                          <CompaniesIcon />
                        </NavIcon>
                        <NavLabel collapsed={collapsed}>Companies</NavLabel>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {savedViewItems("company")}
                  </SidebarMenu>
                </SidebarGroup>

                <SidebarGroup>
                  <SidebarGroupLabel>Email</SidebarGroupLabel>
                  <SidebarMenu>
                    {(
                      [
                        ["/t/$teamId/campaigns", "Campaigns", <SendIcon key="icon" />],
                        ["/t/$teamId/templates", "Templates", <TemplateIcon key="icon" />],
                        ["/t/$teamId/segments", "Segments", <SegmentIcon key="icon" />],
                      ] as const
                    ).map(([to, label, icon]) => (
                      <SidebarMenuItem key={to}>
                        <SidebarMenuButton
                          tooltip={label}
                          render={<Link activeProps={activeProps} to={to} params={{ teamId }} />}
                        >
                          <NavIcon>{icon}</NavIcon>
                          <NavLabel collapsed={collapsed}>{label}</NavLabel>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarContent>

              <SidebarFooter>
                <SidebarGroup>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Settings"
                        render={<Link to="/t/$teamId/settings/general" params={{ teamId }} />}
                      >
                        <NavIcon>
                          <SettingsIcon />
                        </NavIcon>
                        <NavLabel collapsed={collapsed}>Settings</NavLabel>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem className="relative flex">
                      <AccountMenu
                        trigger={
                          <SidebarMenuButton
                            tooltip={props.userName}
                            render={<DropdownMenuTrigger aria-label={`Account menu (${props.userName})`} />}
                          >
                            <NavIcon>
                              <Avatar>{initials}</Avatar>
                            </NavIcon>
                            <NavLabel collapsed={collapsed}>{props.userName}</NavLabel>
                          </SidebarMenuButton>
                        }
                        onCrtSettings={() => setCrtSettingsOpen(true)}
                        onSignOut={async () => {
                          await signOut()
                          await navigate({ to: "/sign-in" })
                        }}
                      />
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarFooter>
            </Sidebar>
          </SidebarProvider>

          <div className="@container/content relative flex min-w-0 flex-[999_1_35rem] gap-1.5 py-1.5 pr-1.5">
            {props.children}
          </div>

          {commandOpen ? <CommandMenu onClose={() => setCommandOpen(false)} /> : null}
          {crtSettingsOpen ? (
            <CrtSettingsDialog crtOn={crtEnabled()} onClose={() => setCrtSettingsOpen(false)} />
          ) : null}
          <Toaster />
        </PortalContainer.Provider>
      </div>
      {crt.overlay}
    </ShellContext.Provider>
  )
}

/** A team's mark: its initial on a dark square. */
function TeamLogo(props: { readonly name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-5.5 shrink-0 place-items-center rounded-md bg-primary text-2xs font-semibold text-on-primary"
    >
      {props.name[0]?.toUpperCase()}
    </span>
  )
}

/** The account menu (opens upward from the sidebar's foot): theme, CRT mode, sign out. */
function AccountMenu(props: {
  readonly trigger: ReactNode
  readonly onSignOut: () => void
  readonly onCrtSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice)
  const [crt, setCrtState] = useState(crtEnabled)
  const choose = (choice: ThemeChoice) => {
    applyTheme(choice)
    setTheme(choice)
  }
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      {props.trigger}
      <DropdownMenuContent side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(choice) => choose(choice as ThemeChoice)}>
            {(["system", "light", "dark"] as const).map((choice) => (
              <DropdownMenuRadioItem key={choice} value={choice}>
                {choice === "system" ? "Match system" : choice === "light" ? "Light" : "Dark"}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <div className="flex items-center gap-px">
          <DropdownMenuItem
            className="flex-1"
            closeOnClick={false}
            onClick={() => {
              setCrt(!crt)
              setCrtState(!crt)
            }}
          >
            CRT mode
            <DropdownMenuShortcut>{crt ? "On" : "Off"}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <IconButton
            label="CRT settings"
            tip="CRT settings"
            size="md"
            onClick={() => {
              setOpen(false)
              props.onCrtSettings()
            }}
          >
            <TuneIcon />
          </IconButton>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={props.onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface CommandEntry {
  readonly id: string
  readonly group: "Contacts" | "Companies" | "Operations" | "Go to"
  readonly label: string
  readonly sub?: string
  readonly hint?: ReactNode
  readonly icon: ReactNode
  readonly run: () => void
}

function CommandMenu(props: { readonly onClose: () => void }) {
  const { team, teams } = useShell()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  // Records are searched on the server as you type (D136): the most recently updated when empty.
  const contacts = useRecordSearch(contactApi, team.id as TeamId, query, { limit: 8 }).items
  const companies = useRecordSearch(companyApi, team.id as TeamId, query, { limit: 6 }).items
  const [active, setActive] = useState("")

  const items = useMemo<ReadonlyArray<CommandEntry>>(() => {
    const q = query.trim().toLowerCase()
    const matches = (text: string) => !q || text.toLowerCase().includes(q)
    const go = (fn: () => unknown) => () => {
      props.onClose()
      void fn()
    }
    const contactItems = contacts.slice(0, q ? 8 : 4).map(
      (contact): CommandEntry => ({
        id: `contact:${contact.id}`,
        group: "Contacts",
        label: contact.displayName,
        ...(contact.emails[0] ? { sub: contact.emails[0].address } : {}),
        hint: "Contact",
        icon: <ContactAvatar contact={contact} />,
        run: go(() =>
          navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: { contact: contact.id } }),
        ),
      }),
    )
    const companyItems = companies.slice(0, q ? 6 : 3).map((company): CommandEntry => {
      const domain = primaryDomainOf(company)
      return {
        id: `company:${company.id}`,
        group: "Companies",
        label: company.name,
        ...(domain ? { sub: domain } : {}),
        hint: "Company",
        icon: <CompanyLogo company={company} />,
        run: go(() =>
          navigate({ to: "/t/$teamId/companies", params: { teamId: team.id }, search: { company: company.id } }),
        ),
      }
    })
    const operations: Array<CommandEntry> = [
      {
        id: "op:new-contact",
        group: "Operations" as const,
        label: "New contact",
        hint: <Kbd>C</Kbd>,
        icon: <PlusIcon />,
        run: go(() => navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: { new: true } })),
      },
      {
        id: "op:new-company",
        group: "Operations" as const,
        label: "New company",
        icon: <PlusIcon />,
        run: go(() => navigate({ to: "/t/$teamId/companies", params: { teamId: team.id }, search: { new: true } })),
      },
      {
        id: "go:companies",
        group: "Go to" as const,
        label: "Companies",
        icon: <CompaniesIcon />,
        run: go(() => navigate({ to: "/t/$teamId/companies", params: { teamId: team.id }, search: {} })),
      },
      {
        id: "op:deleted",
        group: "Operations" as const,
        label: "Show deleted contacts",
        icon: <RestoreIcon />,
        run: go(() => navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: { deleted: true } })),
      },
      {
        id: "go:campaigns",
        group: "Go to" as const,
        label: "Campaigns",
        icon: <SendIcon />,
        run: go(() => navigate({ to: "/t/$teamId/campaigns", params: { teamId: team.id } })),
      },
      {
        id: "go:templates",
        group: "Go to" as const,
        label: "Templates",
        icon: <TemplateIcon />,
        run: go(() => navigate({ to: "/t/$teamId/templates", params: { teamId: team.id } })),
      },
      {
        id: "go:segments",
        group: "Go to" as const,
        label: "Segments",
        icon: <SegmentIcon />,
        run: go(() => navigate({ to: "/t/$teamId/segments", params: { teamId: team.id } })),
      },
      ...(
        [
          ["general", "General"],
          ["members", "Members"],
          ["fields", "Fields"],
          ["email", "Email settings"],
        ] as const
      ).map(
        ([page, label]): CommandEntry => ({
          id: `go:settings-${page}`,
          group: "Go to" as const,
          label,
          hint: "Settings",
          icon: <SettingsIcon />,
          run: go(() => navigate({ to: `/t/$teamId/settings/${page}`, params: { teamId: team.id } })),
        }),
      ),
      {
        id: "go:connections",
        group: "Go to" as const,
        label: "Connections",
        hint: "Settings",
        icon: <SettingsIcon />,
        run: go(() => navigate({ to: "/t/$teamId/settings/connections", params: { teamId: team.id } })),
      },
      {
        id: "go:api-keys",
        group: "Go to" as const,
        label: "API keys",
        hint: "Settings",
        icon: <SettingsIcon />,
        run: go(() => navigate({ to: "/t/$teamId/settings/api-keys", params: { teamId: team.id } })),
      },
      {
        id: "go:service-accounts",
        group: "Go to" as const,
        label: "Service accounts",
        hint: "Settings",
        icon: <SettingsIcon />,
        run: go(() => navigate({ to: "/t/$teamId/settings/service-accounts", params: { teamId: team.id } })),
      },
      ...teams
        .filter((other) => other.id !== team.id)
        .map(
          (other): CommandEntry => ({
            id: `team:${other.id}`,
            group: "Go to" as const,
            label: `Switch to ${other.name}`,
            hint: "Team",
            icon: <SwitchIcon />,
            run: go(() => navigate({ to: "/t/$teamId/contacts", params: { teamId: other.id } })),
          }),
        ),
    ].filter((item) => matches(item.label))
    return [...contactItems, ...companyItems, ...operations]
  }, [contacts, companies, query, team.id, teams, navigate, props])

  // The first result is highlighted whenever the query changes (and while the highlighted one isn't showing), as Enter runs it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight whenever the query changes
  useEffect(() => setActive(""), [query])
  const highlighted = items.some((item) => item.id === active) ? active : (items[0]?.id ?? "")

  const groups = ["Contacts", "Companies", "Operations", "Go to"] as const
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Command shouldFilter={false} value={highlighted} onValueChange={setActive} label="Command menu">
        <CommandInput
          size="lg"
          autoFocus
          autoComplete="off"
          aria-label="Search contacts or run an operation"
          placeholder="Search contacts, or run an operation…"
          value={query}
          onValueChange={setQuery}
          trailing={
            <IconButton label="Close command menu" size="xs" onClick={props.onClose}>
              <CloseIcon className="size-4" />
            </IconButton>
          }
        />
        <CommandList className="max-h-[30rem] px-1.5 pt-1 pb-1.5">
          <CommandEmpty>Nothing matches “{query}”.</CommandEmpty>
          {groups.map((group) => {
            const inGroup = items.filter((item) => item.group === group)
            if (inGroup.length === 0) return null
            return (
              <CommandGroup key={group} heading={group}>
                {inGroup.map((item) => (
                  <CommandItem key={item.id} value={item.id} trailing={item.hint} onSelect={item.run}>
                    <NavIcon>{item.icon}</NavIcon>
                    <span className="shrink-0">{item.label}</span>
                    {item.sub ? <span className="truncate text-subtle">{item.sub}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
