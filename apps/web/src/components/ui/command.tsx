"use client"

import { Command as CommandPrimitive } from "cmdk"
import { cn } from "cn"
import type * as React from "react"
import { SearchIcon } from "../icons.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog.tsx"

/*
 * shadcn's Command (on cmdk), styled as Parley's searchable lists (D80, D139): the ⌘K command
 * menu, and the search-and-pick list inside a popover. cmdk gives arrow-key and Enter handling,
 * the highlighted item and the ARIA combobox roles. Pass `shouldFilter={false}` when the caller
 * filters (such as searching on the server) and render only the matches.
 */

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive data-slot="command" className={cn("flex flex-col overflow-hidden", className)} {...props} />
}

/** The ⌘K command menu: a Command in a dialog near the top of the window. Its title is for screen readers. */
function CommandDialog({
  title = "Command menu",
  description = "Search contacts or run an operation",
  children,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogContent className={cn("top-1/7 max-w-2xl overflow-hidden", className)} showCloseButton={false}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The search row: an icon, a borderless input, and `trailing` (such as a close button). "md" is a
 * popover's (44px); "lg" is the command menu's (56px, larger text).
 */
function CommandInput({
  className,
  size = "md",
  trailing,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Input>, "size"> & {
  size?: "md" | "lg"
  trailing?: React.ReactNode
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        "flex shrink-0 items-center gap-2.5 border-b border-line text-subtle",
        size === "lg" ? "h-14 pr-3 pl-4" : "h-11 px-3",
      )}
    >
      <SearchIcon className={size === "lg" ? undefined : "size-4"} />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-fg outline-none disabled:opacity-50",
          size === "lg" && "text-lg",
          className,
        )}
        {...props}
      />
      {trailing}
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-80 overflow-auto p-1 outline-none", className)}
      {...props}
    />
  )
}

/** What shows when nothing matches, as a heading-sized line. */
function CommandEmpty({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("m-0 px-2 pt-2 pb-1 text-sm text-subtle", className)}
      {...props}
    />
  )
}

/** A group of items under `heading`. */
function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "**:[[cmdk-group-heading]]:m-0 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-sm **:[[cmdk-group-heading]]:text-subtle",
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("mx-0.5 my-1 h-px bg-line", className)}
      {...props}
    />
  )
}

/** An item: 36px, filled while highlighted (by pointer or arrow keys). `trailing` sits on the right, such as a kind or a count. */
function CommandItem({
  className,
  children,
  trailing,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & { trailing?: React.ReactNode }) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-fg outline-none select-none data-selected:bg-active data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {trailing ? <span className="ml-auto truncate text-subtle">{trailing}</span> : null}
    </CommandPrimitive.Item>
  )
}

/** A bar under the list, such as "Create …", with its own top border. Items in it are still part of the Command. */
function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="command-footer" className={cn("border-t border-line p-1", className)} {...props} />
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="command-shortcut" className={cn("ml-auto text-subtle", className)} {...props} />
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
