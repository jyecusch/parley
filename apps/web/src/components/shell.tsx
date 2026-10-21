import type { Team, TeamId } from "@parley/domain"
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
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
import { ContactAvatar } from "./images.tsx"
import { PendingInvitations, usePendingInvitations } from "./pending-invitations.tsx"
import {
  Avatar,
  cn,
  IconButton,
  Kbd,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
  menuItemClass,
  NavGroup,
  NavIcon,
  NavLabel,
  navItemActiveClass,
  navItemClass,
  PopoverHeading,
  PopoverItem,
  Scrim,
  Spacer,
  Tooltip,
} from "./ui/index.ts"

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

/** Closes a popover when the pointer goes down outside it or Escape is pressed. */
const useDismiss = (open: boolean, close: () => void) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, close])
  return ref
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
  const [accountMenu, setAccountMenu] = useState(false)
  const [crtSettingsOpen, setCrtSettingsOpen] = useState(false)
  // Invitations waiting for this person, shown in the team menu (D131).
  const invitations = usePendingInvitations().data ?? []
  const crt = useCrt()
  const closeTeamMenu = useCallback(() => setTeamMenu(false), [])
  const closeAccountMenu = useCallback(() => setAccountMenu(false), [])
  const teamMenuRef = useDismiss(teamMenu, closeTeamMenu)
  const accountMenuRef = useDismiss(accountMenu, closeAccountMenu)

  const toggleSidebar = useCallback(() => {
    setCollapsed((value) => {
      setSidebarCollapsed(!value)
      return !value
    })
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
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault()
        toggleSidebar()
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
  }, [commandOpen, newRecord, toggleSidebar])

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
  const side = (item: { tip: string; children: ReactNode }) => (
    <Tooltip text={item.tip} side="right" disabled={!collapsed} className="flex">
      {item.children}
    </Tooltip>
  )
  const navClass = navItemClass({ collapsed })
  const subClass = cn(navClass, "h-7 text-sm")
  const savedViewLinks = (recordType: "contact" | "company") =>
    savedViews
      .filter((view) => view.recordType === recordType)
      .map((view) => (
        <Tooltip key={view.id} text={view.name} side="right" disabled={!collapsed} className="flex">
          <Link
            className={subClass}
            activeProps={{ className: navItemActiveClass }}
            activeOptions={{ includeSearch: true }}
            to={recordType === "contact" ? "/t/$teamId/contacts" : "/t/$teamId/companies"}
            params={{ teamId }}
            search={{ view: view.id }}
          >
            <NavIcon>
              <span className="size-1.5 rounded-full bg-current opacity-60" />
            </NavIcon>
            <NavLabel collapsed={collapsed}>{view.name}</NavLabel>
          </Link>
        </Tooltip>
      ))

  return (
    <ShellContext.Provider value={shell}>
      <div ref={crt.screenRef} className="relative flex h-dvh w-full overflow-hidden">
        <nav className={cn("group/side flex shrink-0 flex-col p-2", collapsed ? "w-14" : "w-64")} aria-label="Main">
          <div className={cn("mb-3 flex gap-0.5", collapsed ? "flex-col items-center" : "items-center")}>
            <div className={cn("relative flex min-w-0", collapsed ? "w-full" : "flex-1")} ref={teamMenuRef}>
              <button
                className={cn(
                  "flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1.5 font-medium hover:bg-hover",
                  collapsed && "justify-center px-0",
                )}
                type="button"
                aria-label={`Switch team (current: ${props.team.name})${invitations.length > 0 ? `, ${invitations.length} pending ${invitations.length === 1 ? "invitation" : "invitations"}` : ""}`}
                aria-expanded={teamMenu}
                onClick={() => setTeamMenu((open) => !open)}
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
              </button>
              {teamMenu ? (
                <Menu className="top-full left-0 mt-1">
                  <MenuHeading>Teams</MenuHeading>
                  {props.teams.map((team) => (
                    <Link
                      key={team.id}
                      role="menuitem"
                      className={menuItemClass({ active: team.id === props.team.id })}
                      to="/t/$teamId/contacts"
                      params={{ teamId: team.id }}
                      onClick={closeTeamMenu}
                    >
                      <TeamLogo name={team.name} />
                      {team.name}
                    </Link>
                  ))}
                  {invitations.length > 0 ? (
                    <>
                      <MenuSeparator />
                      <MenuHeading>Invitations</MenuHeading>
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
                    </>
                  ) : null}
                  <MenuSeparator />
                  <Link role="menuitem" className={menuItemClass()} to="/new-team" onClick={closeTeamMenu}>
                    <NavIcon>
                      <PlusIcon className="size-4" />
                    </NavIcon>
                    New team
                  </Link>
                </Menu>
              ) : null}
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
              onClick={toggleSidebar}
            >
              <SidebarIcon />
            </IconButton>
          </div>

          <NavGroup collapsed={collapsed}>
            {side({
              tip: "Contacts",
              children: (
                <Link
                  className={navClass}
                  activeProps={{ className: navItemActiveClass }}
                  to="/t/$teamId/contacts"
                  params={{ teamId }}
                  search={{}}
                >
                  <NavIcon>
                    <ContactsIcon />
                  </NavIcon>
                  <NavLabel collapsed={collapsed}>Contacts</NavLabel>
                </Link>
              ),
            })}
            <Tooltip text="My contacts" side="right" disabled={!collapsed} className="flex">
              <Link
                className={subClass}
                activeProps={{ className: navItemActiveClass }}
                activeOptions={{ includeSearch: true }}
                to="/t/$teamId/contacts"
                params={{ teamId }}
                search={{ view: MY_CONTACTS_VIEW }}
              >
                <NavIcon>
                  <span className="size-1.5 rounded-full bg-current opacity-60" />
                </NavIcon>
                <NavLabel collapsed={collapsed}>My contacts</NavLabel>
              </Link>
            </Tooltip>
            {savedViewLinks("contact")}
            {side({
              tip: "Companies",
              children: (
                <Link
                  className={navClass}
                  activeProps={{ className: navItemActiveClass }}
                  to="/t/$teamId/companies"
                  params={{ teamId }}
                  search={{}}
                >
                  <NavIcon>
                    <CompaniesIcon />
                  </NavIcon>
                  <NavLabel collapsed={collapsed}>Companies</NavLabel>
                </Link>
              ),
            })}
            {savedViewLinks("company")}
          </NavGroup>

          <NavGroup label="Email" collapsed={collapsed}>
            {(
              [
                ["/t/$teamId/campaigns", "Campaigns", <SendIcon key="icon" />],
                ["/t/$teamId/templates", "Templates", <TemplateIcon key="icon" />],
                ["/t/$teamId/segments", "Segments", <SegmentIcon key="icon" />],
              ] as const
            ).map(([to, label, icon]) => (
              <Tooltip key={to} text={label} side="right" disabled={!collapsed} className="flex">
                <Link className={navClass} activeProps={{ className: navItemActiveClass }} to={to} params={{ teamId }}>
                  <NavIcon>{icon}</NavIcon>
                  <NavLabel collapsed={collapsed}>{label}</NavLabel>
                </Link>
              </Tooltip>
            ))}
          </NavGroup>

          <Spacer />

          <NavGroup collapsed={collapsed}>
            {side({
              tip: "Settings",
              children: (
                <Link className={navClass} to="/t/$teamId/settings/general" params={{ teamId }}>
                  <NavIcon>
                    <SettingsIcon />
                  </NavIcon>
                  <NavLabel collapsed={collapsed}>Settings</NavLabel>
                </Link>
              ),
            })}
            <div className="relative flex" ref={accountMenuRef}>
              {accountMenu ? (
                <AccountMenu
                  onClose={closeAccountMenu}
                  onCrtSettings={() => {
                    closeAccountMenu()
                    setCrtSettingsOpen(true)
                  }}
                  onSignOut={async () => {
                    await signOut()
                    await navigate({ to: "/sign-in" })
                  }}
                />
              ) : null}
              {side({
                tip: props.userName,
                children: (
                  <button
                    className={navClass}
                    type="button"
                    aria-label={`Account menu (${props.userName})`}
                    aria-expanded={accountMenu}
                    onClick={() => setAccountMenu((open) => !open)}
                  >
                    <NavIcon>
                      <Avatar>{initials}</Avatar>
                    </NavIcon>
                    <NavLabel collapsed={collapsed}>{props.userName}</NavLabel>
                  </button>
                ),
              })}
            </div>
          </NavGroup>
        </nav>

        <div className="@container/content relative flex min-w-0 flex-[999_1_35rem] gap-1.5 py-1.5 pr-1.5">
          {props.children}
        </div>

        {commandOpen ? <CommandMenu onClose={() => setCommandOpen(false)} /> : null}
        {crtSettingsOpen ? <CrtSettingsDialog crtOn={crtEnabled()} onClose={() => setCrtSettingsOpen(false)} /> : null}
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

function AccountMenu(props: {
  readonly onClose: () => void
  readonly onSignOut: () => void
  readonly onCrtSettings: () => void
}) {
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice)
  const [crt, setCrtState] = useState(crtEnabled)
  const choose = (choice: ThemeChoice) => {
    applyTheme(choice)
    setTheme(choice)
  }
  return (
    <Menu className="bottom-full left-0 mb-1">
      <MenuHeading>Theme</MenuHeading>
      {(["system", "light", "dark"] as const).map((choice) => (
        <MenuItem key={choice} active={theme === choice} onClick={() => choose(choice)}>
          {choice === "system" ? "Match system" : choice === "light" ? "Light" : "Dark"}
          {theme === choice ? <span className="ml-auto text-subtle">✓</span> : null}
        </MenuItem>
      ))}
      <div className="flex items-center gap-px">
        <MenuItem
          className="flex-1"
          onClick={() => {
            setCrt(!crt)
            setCrtState(!crt)
          }}
        >
          CRT mode
          <span className="ml-auto text-subtle">{crt ? "On" : "Off"}</span>
        </MenuItem>
        <IconButton label="CRT settings" tip="CRT settings" size="md" onClick={props.onCrtSettings}>
          <TuneIcon />
        </IconButton>
      </div>
      <MenuSeparator />
      <MenuItem
        onClick={() => {
          props.onClose()
          props.onSignOut()
        }}
      >
        Sign out
      </MenuItem>
    </Menu>
  )
}

interface CommandItem {
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
  const [active, setActive] = useState(0)

  const items = useMemo<ReadonlyArray<CommandItem>>(() => {
    const q = query.trim().toLowerCase()
    const matches = (text: string) => !q || text.toLowerCase().includes(q)
    const go = (fn: () => unknown) => () => {
      props.onClose()
      void fn()
    }
    const contactItems = contacts.slice(0, q ? 8 : 4).map(
      (contact): CommandItem => ({
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
    const companyItems = companies.slice(0, q ? 6 : 3).map((company): CommandItem => {
      const domain = primaryDomainOf(company)
      return {
        id: `company:${company.id}`,
        group: "Companies",
        label: company.name,
        ...(domain ? { sub: domain } : {}),
        hint: "Company",
        icon: <Avatar shape="square">{company.name[0]?.toUpperCase()}</Avatar>,
        run: go(() =>
          navigate({ to: "/t/$teamId/companies", params: { teamId: team.id }, search: { company: company.id } }),
        ),
      }
    })
    const operations: Array<CommandItem> = [
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
        ([page, label]): CommandItem => ({
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
          (other): CommandItem => ({
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight whenever the query changes
  useEffect(() => setActive(0), [query])

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, items.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      items[active]?.run()
    } else if (event.key === "Escape") {
      props.onClose()
    }
  }

  const groups = ["Contacts", "Companies", "Operations", "Go to"] as const
  return (
    <>
      <Scrim onClick={props.onClose} />
      <div
        className="fixed top-[14%] left-1/2 z-11 w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-raised shadow-pop"
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-line pr-3 pl-4 text-subtle">
          <SearchIcon />
          <label className="sr-only" htmlFor="cmd-input">
            Search contacts or run an operation
          </label>
          <input
            id="cmd-input"
            className="min-w-0 flex-1 bg-transparent text-lg text-fg outline-none"
            // biome-ignore lint/a11y/noAutofocus: the command menu is a dialog opened to type into
            autoFocus
            autoComplete="off"
            placeholder="Search contacts, or run an operation…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
          />
          <IconButton label="Close command menu" size="xs" onClick={props.onClose}>
            <CloseIcon className="size-4" />
          </IconButton>
        </div>
        <div className="max-h-[30rem] overflow-auto px-1.5 pt-1 pb-1.5">
          {items.length === 0 ? <PopoverHeading>Nothing matches “{query}”.</PopoverHeading> : null}
          {groups.map((group) => {
            const inGroup = items.filter((item) => item.group === group)
            if (inGroup.length === 0) return null
            return (
              <div key={group}>
                <PopoverHeading>{group}</PopoverHeading>
                {inGroup.map((item) => {
                  const index = items.indexOf(item)
                  return (
                    <PopoverItem
                      key={item.id}
                      active={index === active}
                      trailing={item.hint}
                      onMouseEnter={() => setActive(index)}
                      onClick={item.run}
                    >
                      <NavIcon>{item.icon}</NavIcon>
                      <span className="shrink-0">{item.label}</span>
                      {item.sub ? <span className="truncate text-subtle">{item.sub}</span> : null}
                    </PopoverItem>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
