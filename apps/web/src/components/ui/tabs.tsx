import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "./cn.ts"

/*
 * shadcn's Tabs (Base UI), in Parley's look (D139): small pill tabs, the chosen one filled. Arrow
 * keys move between tabs, as Base UI's tablist does.
 */

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex flex-wrap gap-0.5 border-b border-line p-2", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "cursor-pointer rounded-md px-2.5 py-1.5 text-muted transition-colors hover:text-fg data-active:bg-active data-active:text-fg motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 overflow-auto outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
