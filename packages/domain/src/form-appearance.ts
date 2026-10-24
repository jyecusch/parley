import type { FieldProblem } from "./errors/input.ts"
import type { AppearanceOverride, FormAppearance, FormColors } from "./forms.ts"

/*
 * A form's appearance (D148) as CSS: its colors and the shared sizes, then the
 * allowlisted rules. Pure, so the designer preview, the form page and the server's checks agree.
 */

/** The public classes a form's markup carries, and the properties rules may set on each. */
const TEXT = [
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-transform",
  "text-align",
]
const BOX = [
  "background",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "border-width",
  "box-shadow",
  "padding",
  "margin",
  "height",
  "min-height",
  "opacity",
  "outline",
  "outline-offset",
]
export const APPEARANCE_CLASSES: Readonly<Record<string, ReadonlyArray<string>>> = {
  ".Form": [...TEXT, ...BOX, "gap", "max-width"],
  ".Title": TEXT,
  ".Description": TEXT,
  ".Label": TEXT,
  ".Input": [...TEXT, ...BOX],
  ".Checkbox": [...TEXT, "accent-color", "gap"],
  ".Button": [...TEXT, ...BOX, "width"],
  ".FinePrint": TEXT,
  ".Message": [...TEXT, ...BOX],
  ".Error": TEXT,
}
const STATES = [":hover", ":focus", ":focus-visible", ":disabled", "::placeholder", "--invalid"]

/** A rule's selector: one public class, with at most one state. */
const selectorParts = (selector: string) => {
  const match = /^(\.[A-Z][A-Za-z]+)(:hover|:focus|:focus-visible|:disabled|::placeholder|--invalid)?$/.exec(
    selector.trim(),
  )
  return match ? { base: match[1] ?? "", state: match[2] } : undefined
}

/** A value can't break out of its declaration or load anything. */
const safeValue = (value: string) => !/[;{}<>\\]|url\s*\(|expression\s*\(|@import|javascript:/i.test(value)

/** Problems with an appearance's rules, as InputRejected takes them. */
export const appearanceProblems = (appearance: FormAppearance): Array<FieldProblem> => {
  const problems: Array<FieldProblem> = []
  for (const [selector, declarations] of Object.entries(appearance.rules)) {
    const parts = selectorParts(selector)
    const allowed = parts ? APPEARANCE_CLASSES[parts.base] : undefined
    if (!parts || !allowed) {
      problems.push({
        field: `appearance.rules.${selector}`,
        problem: "not-allowed",
        userMessage:
          `Rules can style ${Object.keys(APPEARANCE_CLASSES).join(", ")}, with ${STATES.join(", ")}. "${selector}" isn't one of those.` as never,
      })
      continue
    }
    for (const [property, value] of Object.entries(declarations)) {
      if (!allowed.includes(property)) {
        problems.push({
          field: `appearance.rules.${selector}.${property}`,
          problem: "not-allowed",
          userMessage: `${parts.base} can't set ${property}. It can set ${allowed.join(", ")}.` as never,
        })
      } else if (!safeValue(value)) {
        problems.push({
          field: `appearance.rules.${selector}.${property}`,
          problem: "invalid-format",
          userMessage: `That value for ${property} isn't allowed: no semicolons, braces or url().` as never,
        })
      }
    }
  }
  return problems
}

/** The colors a new form starts with, and its dark mode colors. */
export const DEFAULT_COLORS: FormColors = {
  heading: "#111111",
  text: "#1a1a1a",
  muted: "#5c5c5c",
  accent: "#1a1a1a",
  buttonText: "#ffffff",
  background: "#ffffff",
  border: "#d4d4d4",
}
export const DEFAULT_DARK_COLORS: FormColors = {
  heading: "#f7f7f7",
  text: "#ededed",
  muted: "#a3a3a3",
  accent: "#f2f2f2",
  buttonText: "#111111",
  background: "#161616",
  border: "#3a3a3a",
}
/** Errors keep a color that reads on a light or a dark background; not themed. */
const ERROR = { light: "#c2410c", dark: "#fb923c" } as const

/** Whether a background is dark: a hex color below mid luminance. Others count as light. */
const isDark = (background: string): boolean => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(background)?.[1]
  if (!hex) return false
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) < 128
}

/** The CSS variables for one set of colors, plus the shared ones. */
const variablesFor = (colors: FormColors, error: string, appearance: FormAppearance) =>
  [
    `--pf-heading:${colors.heading}`,
    `--pf-text:${colors.text}`,
    `--pf-muted:${colors.muted}`,
    `--pf-background:${colors.background}`,
    `--pf-border:${colors.border}`,
    `--pf-primary:${colors.accent}`,
    `--pf-on-primary:${colors.buttonText}`,
    `--pf-error:${error}`,
    `--pf-font:${appearance.fontFamily ? `${JSON.stringify(appearance.fontFamily)}, ` : ""}system-ui, -apple-system, "Segoe UI", sans-serif`,
    `--pf-size:${appearance.fontSizeBase}px`,
    `--pf-radius:${appearance.radius}px`,
    `--pf-gap:${appearance.spacing}px`,
  ].join(";")

/**
 * The stylesheet for a form: its structure, its colors, then its rules. `mode` forces light or
 * dark mode for "light-dark" colors, as the designer's preview does; visitors get the media query.
 */
export const appearanceCss = (appearance: FormAppearance, scope = ".Form", mode?: "light" | "dark"): string => {
  const colors = variablesFor(
    appearance.colors,
    appearance.colorMode === "light-dark" || !isDark(appearance.colors.background) ? ERROR.light : ERROR.dark,
    appearance,
  )
  const dark = variablesFor(appearance.darkColors, ERROR.dark, appearance)
  const theme =
    appearance.colorMode === "fixed" || mode === "light"
      ? `${scope}{${colors}}`
      : mode === "dark"
        ? `${scope}{${dark}}`
        : `${scope}{${colors}}@media (prefers-color-scheme: dark){${scope}{${dark}}}`
  const hidden = appearance.labels === "hidden"
  const structure = `
${scope}{box-sizing:border-box;display:flex;flex-direction:column;gap:var(--pf-gap);padding:24px;border-radius:calc(var(--pf-radius) + 4px);background:var(--pf-background);color:var(--pf-text);font-family:var(--pf-font);font-size:var(--pf-size);line-height:1.45}
${scope} *{box-sizing:border-box}
${scope} .Title{margin:0;color:var(--pf-heading);font-size:1.35em;font-weight:650;line-height:1.2}
${scope} .Description{margin:0;color:var(--pf-muted)}
${scope} .Field{display:flex;flex-direction:column;gap:6px;border:0;margin:0;padding:0}
${scope} .Label{font-size:0.875em;font-weight:600}${hidden ? `${scope} .Label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}` : ""}
${scope} .Optional{font-weight:400;color:var(--pf-muted)}
${scope} .Input{width:100%;height:2.6em;padding:0 0.75em;border:1px solid var(--pf-border);border-radius:var(--pf-radius);background:transparent;color:inherit;font:inherit}
${scope} .Input:focus{outline:2px solid var(--pf-primary);outline-offset:1px}
${scope} .Input--invalid{border-color:var(--pf-error)}
${scope} .Checkbox{display:flex;gap:10px;align-items:flex-start;font-size:0.9em}
${scope} .Checkbox input{margin-top:0.2em;width:1em;height:1em;accent-color:var(--pf-primary)}
${scope} .Button{height:2.75em;border:0;border-radius:var(--pf-radius);background:var(--pf-primary);color:var(--pf-on-primary);font:inherit;font-weight:600;cursor:pointer}
${scope} .Button:disabled{opacity:0.6;cursor:default}
${scope} .FinePrint{margin:0;font-size:0.78em;color:var(--pf-muted)}
${scope} .FinePrint a{color:inherit}
${scope} .Error{margin:0;font-size:0.85em;color:var(--pf-error)}
${scope} .Message{display:flex;flex-direction:column;gap:4px}
${scope} .Honey{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}`
  const rules = Object.entries(appearance.rules)
    .flatMap(([selector, declarations]) => {
      const parts = selectorParts(selector)
      const allowed = parts ? APPEARANCE_CLASSES[parts.base] : undefined
      if (!parts || !allowed) return []
      const body = Object.entries(declarations)
        .filter(([property, value]) => allowed.includes(property) && safeValue(value))
        .map(([property, value]) => `${property}:${value}`)
        .join(";")
      if (!body) return []
      const state = parts.state === "--invalid" ? "" : (parts.state ?? "")
      const base = parts.state === "--invalid" ? `${parts.base}--invalid` : parts.base
      // .Form is the scope itself; the others sit inside it.
      const target = base === ".Form" ? `${scope}${state}` : `${scope} ${base}${state}`
      return [`${target}{${body}}`]
    })
    .join("\n")
  return `${theme}\n${structure}\n${rules}`
}

/** The appearance a new form starts with. */
export const DEFAULT_APPEARANCE: FormAppearance = {
  colorMode: "fixed",
  colors: DEFAULT_COLORS,
  darkColors: DEFAULT_DARK_COLORS,
  fontFamily: null,
  fontSizeBase: 16,
  radius: 8,
  spacing: 14,
  labels: "above",
  rules: {},
  fonts: [],
}

/** A set of colors with the ones an override gives. */
const mergeColors = (base: FormColors, override: AppearanceOverride["colors"]): FormColors => {
  const given = Object.fromEntries(Object.entries(override ?? {}).filter(([, value]) => value !== undefined))
  return { ...base, ...given }
}

/**
 * An appearance with overrides from where it's embedded (D148): whatever the embed gives wins,
 * color by color; rules from both apply. The caller checks the override is a valid one.
 */
export const mergeAppearance = (base: FormAppearance, override: AppearanceOverride): FormAppearance => ({
  colorMode: override.colorMode ?? base.colorMode,
  colors: mergeColors(base.colors, override.colors),
  darkColors: mergeColors(base.darkColors, override.darkColors),
  fontFamily: override.fontFamily !== undefined ? override.fontFamily : base.fontFamily,
  fontSizeBase: override.fontSizeBase ?? base.fontSizeBase,
  radius: override.radius ?? base.radius,
  spacing: override.spacing ?? base.spacing,
  labels: override.labels ?? base.labels,
  rules: { ...base.rules, ...override.rules },
  fonts: [...base.fonts, ...(override.fonts ?? [])].slice(0, 3),
})
