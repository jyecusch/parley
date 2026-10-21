"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "cn"
import type * as React from "react"
import { usePortalContainer } from "./portal-container.ts"

/*
 * shadcn's DropdownMenu (on Base UI), styled as Parley's menus (D80, D139): a raised panel of
 * 36px rows, the highlighted one filled. Base UI gives it keyboard navigation, typeahead, focus
 * return and dismissal. Popups render into the app's screen (portal-container.ts).
 */

/** A menu item's classes, for anything that should look like one. */
export const menuItemClassName =
  "relative flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left whitespace-nowrap text-fg no-underline outline-none select-none hover:bg-active data-highlighted:bg-active data-disabled:cursor-default data-disabled:opacity-50"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" container={usePortalContainer()} {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

/** The menu. It opens below its trigger, 4px away (as `top-full mt-1` did), lined up with its start. */
function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        className="isolate z-40 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "flex max-h-(--available-height) min-w-60 flex-col gap-px overflow-y-auto rounded-lg bg-raised p-1 shadow-pop outline-none",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" className="flex flex-col gap-px" {...props} />
}

/** A heading over a group of items. It names the DropdownMenuGroup it sits in. */
function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn("m-0 px-2.5 pt-2 pb-0.5 text-sm text-subtle", className)}
      {...props}
    />
  )
}

/**
 * An item. `active` marks the current choice; `variant="destructive"` is for deleting. Use
 * `render` to make it a link, such as `render={<Link to="…" />}`.
 */
function DropdownMenuItem({
  className,
  active,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  active?: boolean | undefined
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(menuItemClassName, active && "bg-active", variant === "destructive" && "text-danger", className)}
      {...props}
    />
  )
}

/**
 * An item that navigates, such as `render={<Link to="/new-team" />}`. It closes the menu when
 * followed; `active` marks the current place.
 */
function DropdownMenuLinkItem({
  className,
  active,
  closeOnClick = true,
  ...props
}: MenuPrimitive.LinkItem.Props & { active?: boolean | undefined }) {
  return (
    <MenuPrimitive.LinkItem
      data-slot="dropdown-menu-link-item"
      closeOnClick={closeOnClick}
      className={cn(menuItemClassName, active && "bg-active", className)}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({ className, children, ...props }: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(menuItemClassName, "data-popup-open:bg-active", className)}
      {...props}
    >
      {children}
      <span aria-hidden className="ml-auto text-subtle">
        ›
      </span>
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -4,
  side = "right",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

/** The ✓ that marks a checked item, on the right. */
function Check() {
  return <span className="ml-auto text-subtle">✓</span>
}

/** An item that turns something on or off, with a ✓ while it's on. */
function DropdownMenuCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(menuItemClassName, className)}
      {...props}
    >
      {children}
      <MenuPrimitive.CheckboxItemIndicator render={<Check />} />
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" className="flex flex-col gap-px" {...props} />
}

/** One of a radio group's choices: the chosen one is filled and has a ✓, as the theme menu's did. */
function DropdownMenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(menuItemClassName, "data-checked:bg-active", className)}
      {...props}
    >
      {children}
      <MenuPrimitive.RadioItemIndicator render={<Check />} />
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-0.5 my-1 h-px shrink-0 bg-line", className)}
      {...props}
    />
  )
}

/** Text on an item's right, such as "On" or a shortcut. */
function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="dropdown-menu-shortcut" className={cn("ml-auto text-subtle", className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
