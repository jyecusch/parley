import type { Contact, Team, TeamId } from "@parley/domain"
import { useLiveQuery } from "@tanstack/react-db"
import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
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
import { contactsCollection, initialsOf } from "../lib/contacts.ts"
import { useCrt } from "./crt.tsx"
import {
  ChevronDown,
  CloseIcon,
  ContactsIcon,
  PlusIcon,
  RestoreIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  SwitchIcon,
} from "./icons.tsx"

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

  const newContact = useCallback(
    () => navigate({ to: "/t/$teamId/contacts", params: { teamId: props.team.id }, search: { new: true } }),
    [navigate, props.team.id],
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
        void newContact()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [commandOpen, newContact, toggleSidebar])

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

  return (
    <ShellContext.Provider value={shell}>
      <div ref={crt.screenRef} className={`app ${collapsed ? "sb-collapsed" : ""}`}>
        <nav className="side" aria-label="Main">
          <div className="sb-top">
            <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }} ref={teamMenuRef}>
              <button
                className="team"
                type="button"
                aria-label={`Switch team (current: ${props.team.name})`}
                aria-expanded={teamMenu}
                onClick={() => setTeamMenu((open) => !open)}
              >
                <span className="logo">{props.team.name[0]?.toUpperCase()}</span>
                <span className="lbl">{props.team.name}</span>
                <span className="chev">
                  <ChevronDown />
                </span>
              </button>
              {teamMenu ? (
                <div className="menu" style={{ top: 32, left: 0 }}>
                  <p className="menu-h sm-t">Teams</p>
                  {props.teams.map((team) => (
                    <Link
                      key={team.id}
                      className={`menu-i ${team.id === props.team.id ? "on" : ""}`}
                      to="/t/$teamId/contacts"
                      params={{ teamId: team.id }}
                      onClick={closeTeamMenu}
                    >
                      <span className="logo">{team.name[0]?.toUpperCase()}</span>
                      {team.name}
                    </Link>
                  ))}
                  <div className="menu-sep" />
                  <Link className="menu-i" to="/new-team" onClick={closeTeamMenu}>
                    <span className="ic">
                      <PlusIcon size={14} />
                    </span>
                    New team
                  </Link>
                </div>
              ) : null}
            </div>
            <button
              className="ibtn tip tip-b"
              type="button"
              aria-label="Search"
              data-tip="Search  ⌘K"
              onClick={() => setCommandOpen(true)}
            >
              <SearchIcon />
            </button>
            <button
              className="ibtn tip tip-b sb-new"
              type="button"
              aria-label="New contact"
              data-tip="New contact  C"
              onClick={() => void newContact()}
            >
              <PlusIcon />
            </button>
            <button
              className="ibtn tip tip-b sb-toggle"
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              data-tip={`${collapsed ? "Expand" : "Collapse"} sidebar  ⌘\\`}
              onClick={toggleSidebar}
            >
              <SidebarIcon />
            </button>
          </div>

          <div className="group">
            <Link
              className="nav tip tip-r"
              activeProps={{ className: "nav tip tip-r on" }}
              to="/t/$teamId/contacts"
              params={{ teamId: props.team.id }}
              search={{}}
              data-tip="Contacts"
            >
              <span className="ic">
                <ContactsIcon />
              </span>
              <span className="lbl">Contacts</span>
            </Link>
          </div>

          <div className="spacer" />

          <div className="group">
            <Link
              className="nav tip tip-r"
              to="/t/$teamId/settings/connections"
              params={{ teamId: props.team.id }}
              data-tip="Settings"
            >
              <span className="ic">
                <SettingsIcon />
              </span>
              <span className="lbl">Settings</span>
            </Link>
          </div>

          <div className="group" ref={accountMenuRef} style={{ position: "relative" }}>
            {accountMenu ? (
              <AccountMenu
                onClose={closeAccountMenu}
                onSignOut={async () => {
                  await signOut()
                  await navigate({ to: "/sign-in" })
                }}
              />
            ) : null}
            <button
              className="nav tip tip-r"
              type="button"
              aria-label={`Account menu (${props.userName})`}
              aria-expanded={accountMenu}
              data-tip={props.userName}
              onClick={() => setAccountMenu((open) => !open)}
            >
              <span className="ic">
                <span className="av">{initials}</span>
              </span>
              <span className="lbl">{props.userName}</span>
            </button>
          </div>
        </nav>

        <div className="content">{props.children}</div>

        {commandOpen ? <CommandMenu onClose={() => setCommandOpen(false)} /> : null}
      </div>
      {crt.overlay}
    </ShellContext.Provider>
  )
}

function AccountMenu(props: { readonly onClose: () => void; readonly onSignOut: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice)
  const [crt, setCrtState] = useState(crtEnabled)
  const choose = (choice: ThemeChoice) => {
    applyTheme(choice)
    setTheme(choice)
  }
  return (
    <div className="menu" style={{ bottom: 32, left: 0 }}>
      <p className="menu-h sm-t">Theme</p>
      {(["system", "light", "dark"] as const).map((choice) => (
        <button
          key={choice}
          className={`menu-i ${theme === choice ? "on" : ""}`}
          type="button"
          onClick={() => choose(choice)}
        >
          {choice === "system" ? "Match system" : choice === "light" ? "Light" : "Dark"}
          {theme === choice ? <span className="hint">✓</span> : null}
        </button>
      ))}
      <button
        className="menu-i"
        type="button"
        onClick={() => {
          setCrt(!crt)
          setCrtState(!crt)
        }}
      >
        CRT mode
        <span className="hint">{crt ? "On" : "Off"}</span>
      </button>
      <div className="menu-sep" />
      <button
        className="menu-i"
        type="button"
        onClick={() => {
          props.onClose()
          props.onSignOut()
        }}
      >
        Sign out
      </button>
    </div>
  )
}

interface CommandItem {
  readonly id: string
  readonly group: "Contacts" | "Operations" | "Go to"
  readonly label: string
  readonly sub?: string
  readonly hint?: ReactNode
  readonly icon: ReactNode
  readonly run: () => void
}

function CommandMenu(props: { readonly onClose: () => void }) {
  const { team, teams } = useShell()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collection = contactsCollection(team.id as TeamId, queryClient)
  const { data: contacts } = useLiveQuery((q) => q.from({ contact: collection }), [collection])
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)

  const items = useMemo<ReadonlyArray<CommandItem>>(() => {
    const q = query.trim().toLowerCase()
    const matches = (text: string) => !q || text.toLowerCase().includes(q)
    const go = (fn: () => unknown) => () => {
      props.onClose()
      void fn()
    }
    const contactItems = [...(contacts ?? [])]
      .filter((contact: Contact) => matches(contact.displayName) || contact.emails.some((e) => matches(e.address)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, q ? 8 : 4)
      .map(
        (contact): CommandItem => ({
          id: `contact:${contact.id}`,
          group: "Contacts",
          label: contact.displayName,
          ...(contact.emails[0] ? { sub: contact.emails[0].address } : {}),
          hint: <span className="sm-t">Contact</span>,
          icon: <span className="av">{initialsOf(contact)}</span>,
          run: go(() =>
            navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: { contact: contact.id } }),
          ),
        }),
      )
    const operations: Array<CommandItem> = [
      {
        id: "op:new-contact",
        group: "Operations" as const,
        label: "New contact",
        hint: <span className="kbd">C</span>,
        icon: <PlusIcon />,
        run: go(() => navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: { new: true } })),
      },
      {
        id: "op:deleted",
        group: "Operations" as const,
        label: "Show deleted contacts",
        icon: <RestoreIcon />,
        run: go(() => navigate({ to: "/t/$teamId/contacts", params: { teamId: team.id }, search: { deleted: true } })),
      },
      {
        id: "go:connections",
        group: "Go to" as const,
        label: "Connections",
        hint: <span className="sm-t">Settings</span>,
        icon: <SettingsIcon />,
        run: go(() => navigate({ to: "/t/$teamId/settings/connections", params: { teamId: team.id } })),
      },
      {
        id: "go:api-keys",
        group: "Go to" as const,
        label: "API keys",
        hint: <span className="sm-t">Settings</span>,
        icon: <SettingsIcon />,
        run: go(() => navigate({ to: "/t/$teamId/settings/api-keys", params: { teamId: team.id } })),
      },
      {
        id: "go:service-accounts",
        group: "Go to" as const,
        label: "Service accounts",
        hint: <span className="sm-t">Settings</span>,
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
            hint: <span className="sm-t">Team</span>,
            icon: <SwitchIcon />,
            run: go(() => navigate({ to: "/t/$teamId/contacts", params: { teamId: other.id } })),
          }),
        ),
    ].filter((item) => matches(item.label))
    return [...contactItems, ...operations]
  }, [contacts, query, team.id, teams, navigate, props])

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

  const groups = ["Contacts", "Operations", "Go to"] as const
  return (
    <>
      <button className="scrim" type="button" tabIndex={-1} aria-hidden="true" onClick={props.onClose} />
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmd-in">
          <SearchIcon />
          <label className="vh" htmlFor="cmd-input">
            Search contacts or run an operation
          </label>
          <input
            id="cmd-input"
            // biome-ignore lint/a11y/noAutofocus: the command menu is a dialog opened to type into
            autoFocus
            autoComplete="off"
            placeholder="Search contacts, or run an operation…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKey}
          />
          <button className="ibtn" type="button" aria-label="Close command menu" onClick={props.onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="cmd-list">
          {items.length === 0 ? <p className="cmd-gh sm-t">Nothing matches “{query}”.</p> : null}
          {groups.map((group) => {
            const inGroup = items.filter((item) => item.group === group)
            if (inGroup.length === 0) return null
            return (
              <div key={group}>
                <p className="cmd-gh sm-t">{group}</p>
                {inGroup.map((item) => {
                  const index = items.indexOf(item)
                  return (
                    <button
                      key={item.id}
                      className={`cmd-i ${index === active ? "on" : ""}`}
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={item.run}
                    >
                      <span className="ic">{item.icon}</span>
                      <span>{item.label}</span>
                      {item.sub ? <span className="sub2">{item.sub}</span> : null}
                      {item.hint ? <span className="hint">{item.hint}</span> : null}
                    </button>
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
