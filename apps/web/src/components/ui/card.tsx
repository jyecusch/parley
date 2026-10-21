import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "./cn.ts"

/**
 * A raised surface, in Parley's look (D80). A `<div>` unless `render` makes it another element,
 * such as `<main>` or `<aside>`.
 */
function Card({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-surface shadow-card",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "card" },
  })
}

export { Card }
