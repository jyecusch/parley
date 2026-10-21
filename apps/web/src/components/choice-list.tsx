import { Radio } from "@base-ui/react/radio"
import type { ReactNode } from "react"
import { cn } from "./ui/index.ts"
import { RadioGroup } from "./ui/radio-group.tsx"

/**
 * A list of choices in a box, picking one (shadcn's RadioGroup): rows that fill when chosen, with
 * arrow keys moving between them. For pickers inside a form, such as a company or a segment.
 */
export function ChoiceList<Value extends string>(props: {
  readonly label: string
  readonly value: Value | undefined
  readonly onChange: (value: Value) => void
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <RadioGroup
      aria-label={props.label}
      value={props.value ?? null}
      onValueChange={(value) => props.onChange(value as Value)}
      className={cn("rounded-lg border border-line-strong", props.className)}
    >
      {props.children}
    </RadioGroup>
  )
}

/** A row in a ChoiceList; `trailing` sits on the right. */
export function ChoiceItem(props: {
  readonly value: string
  readonly trailing?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Radio.Root
      value={props.value}
      nativeButton
      render={<button type="button" />}
      className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-fg hover:bg-active data-checked:bg-active"
    >
      {props.children}
      {props.trailing ? <span className="ml-auto truncate text-subtle">{props.trailing}</span> : null}
    </Radio.Root>
  )
}
