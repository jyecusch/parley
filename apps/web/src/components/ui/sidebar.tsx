import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { tipPlacement } from "./buttons.tsx"
import { cn } from "./cn.ts"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx"

/*
 * shadcn's Sidebar, cut to the parts Parley uses and drawn in Parley's look (D80, D139): a 16rem
 * column of navigation that collapses to 3.5rem of icons, with tooltips naming each item while
 * collapsed. Where its collapsed state is kept is the caller's business (the app shell keeps it in
 * localStorage); there is no cookie and no mobile sheet.
 */

interface SidebarContextProps {
  readonly state: "expanded" | "collapsed"
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.")
  return context
}

/**
 * Holds whether the sidebar is open. Renders no element of its own, so the sidebar sits directly
 * in the app's screen beside its content. `shortcut` is the key that, with ⌘ or Ctrl, toggles it.
 */
function SidebarProvider({
  open,
  onOpenChange,
  shortcut,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  readonly shortcut?: string | undefined
  readonly children: React.ReactNode
}) {
  const setOpen = React.useCallback((next: boolean) => onOpenChange?.(next), [onOpenChange])
  const toggleSidebar = React.useCallback(() => onOpenChange?.(!open), [onOpenChange, open])

  React.useEffect(() => {
    if (!shortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === shortcut && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [shortcut, toggleSidebar])

  const value = React.useMemo<SidebarContextProps>(
    () => ({ state: open ? "expanded" : "collapsed", open, setOpen, toggleSidebar }),
    [open, setOpen, toggleSidebar],
  )
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

/** The sidebar itself: a <nav>. `group/side` lets its parts react to hovering it. */
function Sidebar({ className, ...props }: React.ComponentProps<"nav">) {
  const { state } = useSidebar()
  return (
    <nav
      data-slot="sidebar"
      data-state={state}
      className={cn("group/side flex shrink-0 flex-col p-2", state === "collapsed" ? "w-14" : "w-64", className)}
      {...props}
    />
  )
}

/** The sidebar's top row, such as the team switcher and its buttons, or a way back. */
function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  const { state } = useSidebar()
  return (
    <div
      data-slot="sidebar-header"
      className={cn("mb-3 flex gap-0.5", state === "collapsed" ? "flex-col items-center" : "items-center", className)}
      {...props}
    />
  )
}

/** The groups between the header and the footer. It takes the free height, pushing the footer down. */
function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" className={cn("flex flex-1 flex-col", className)} {...props} />
}

/** The groups at the foot of the sidebar. */
function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("flex flex-col", className)} {...props} />
}

/** A group of items, with an optional label. Groups that follow one another are spaced apart. */
function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group" className={cn("flex flex-col gap-px [&+&]:mt-4", className)} {...props} />
}

/** A group's heading. Collapsed, it keeps a little space but hides its text. */
function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"h2">) {
  const { state } = useSidebar()
  return (
    <h2
      data-slot="sidebar-group-label"
      className={cn(
        "m-0 flex h-7 items-center px-1.5 text-sm font-medium text-subtle",
        state === "collapsed" && "invisible h-2",
        className,
      )}
      {...props}
    />
  )
}

/** A group's items, as a list. */
function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("flex flex-col gap-px", className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={className} {...props} />
}

const sidebarMenuButtonVariants = cva(
  [
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-left whitespace-nowrap text-muted no-underline transition-colors hover:bg-hover hover:text-fg motion-reduce:transition-none",
    "disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
  ],
  {
    variants: {
      size: { default: "h-8", sm: "h-7 text-sm" },
      collapsed: { true: "justify-center px-0", false: "" },
    },
    defaultVariants: { size: "default", collapsed: false },
  },
)

/**
 * Added to an item when it's the current page. For TanStack links, which add it themselves:
 * `render={<Link activeProps={{ className: sidebarMenuButtonActiveClass }} … />}`.
 */
const sidebarMenuButtonActiveClass = "bg-active font-medium text-fg [&_[data-nav-icon]]:text-fg"

/**
 * An item: a button, or the element `render` gives (such as a link or a menu trigger). `tooltip`
 * names it while the sidebar is collapsed.
 */
function SidebarMenuButton({
  render,
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> & {
  readonly tooltip?: string | undefined
} & Pick<VariantProps<typeof sidebarMenuButtonVariants>, "size">) {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"
  const element = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      { className: cn(sidebarMenuButtonVariants({ size, collapsed }), className) },
      { type: render ? undefined : "button", ...props },
    ),
    render,
    state: { slot: "sidebar-menu-button" },
  })
  if (tooltip === undefined) return element
  return (
    <Tooltip disabled={!collapsed}>
      <TooltipTrigger render={element} />
      <TooltipContent {...tipPlacement("right")}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export {
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
  sidebarMenuButtonVariants,
  useSidebar,
}
