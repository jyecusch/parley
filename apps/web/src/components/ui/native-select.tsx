import { cn } from "cn"
import type * as React from "react"
import { ChevronDown } from "@/components/icons"
import { boxedControlClass } from "@/components/ui/input"

type NativeSelectProps = React.ComponentProps<"select"> & {
  /** "inline" looks like plain text until hovered, as in record panels. */
  variant?: "boxed" | "inline" | undefined
  /** Something before the value, such as a team's logo (boxed only). */
  leading?: React.ReactNode
}

/** A native `<select>`, so the browser's own list opens. `className` styles the select itself. */
function NativeSelect({ variant = "boxed", leading, className, ...props }: NativeSelectProps) {
  if (variant === "inline") {
    return (
      <select
        data-slot="native-select"
        className={cn(
          "-mx-1.5 h-8 w-full cursor-pointer appearance-none rounded-md bg-transparent px-1.5 text-fg hover:bg-hover",
          className,
        )}
        {...props}
      />
    )
  }
  return (
    <div className="relative" data-slot="native-select-wrapper">
      {leading ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">{leading}</span> : null}
      <select
        data-slot="native-select"
        className={cn(
          boxedControlClass,
          "h-10 cursor-pointer appearance-none pr-9 pl-3",
          leading && "pl-11",
          className,
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-subtle" />
    </div>
  )
}

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />
}

function NativeSelectOptGroup(props: React.ComponentProps<"optgroup">) {
  return <optgroup data-slot="native-select-optgroup" {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
