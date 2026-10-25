import {
  APPEARANCE_CLASSES,
  APPEARANCE_STATES,
  DEFAULT_COLORS,
  DEFAULT_DARK_COLORS,
  FONT_HOSTS,
  type FormAppearance,
  type FormColors,
} from "@parley/domain"
import { useEffect, useState } from "react"
import {
  Checkbox,
  ErrorText,
  Field,
  Fieldset,
  Hint,
  InfoTip,
  Input,
  Option,
  SegmentedControl,
  Select,
  Slider,
  SmallInput,
  Textarea,
} from "../ui/index.ts"
import { type ContentChange, PAGE_OPTIONS } from "./shared.tsx"

/** A form's rules as editable text: `.Button { text-transform: uppercase; }`. */
const rulesToText = (rules: FormAppearance["rules"]) =>
  Object.entries(rules)
    .map(
      ([selector, body]) =>
        `${selector} {\n${Object.entries(body)
          .map(([p, v]) => `  ${p}: ${v};`)
          .join("\n")}\n}`,
    )
    .join("\n\n")

const textToRules = (text: string): FormAppearance["rules"] => {
  const rules: Record<string, Record<string, string>> = {}
  for (const match of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = (match[1] ?? "").trim()
    if (!selector) continue
    const body: Record<string, string> = {}
    for (const declaration of (match[2] ?? "").split(";")) {
      const at = declaration.indexOf(":")
      if (at < 0) continue
      const property = declaration.slice(0, at).trim().toLowerCase()
      const value = declaration.slice(at + 1).trim()
      if (property && value) body[property] = value
    }
    rules[selector] = { ...rules[selector], ...body }
  }
  return rules
}

const COLOR_MODE_OPTIONS = [
  { value: "fixed", label: "Fixed" },
  { value: "light-dark", label: "Light and dark" },
] as const

/** A scheme's colors, in the order the panel lists them (D148). */
const COLORS: ReadonlyArray<readonly [Exclude<keyof FormColors & string, "background">, string]> = [
  ["heading", "Heading"],
  ["text", "Text"],
  ["muted", "Muted text"],
  ["accent", "Accent"],
  ["buttonText", "Button text"],
  ["border", "Field border"],
]

const HEX = /^#[0-9a-f]{6}$/i

/** One color: a swatch to pick it and its value to type, kept in step. */
function ColorRow(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${props.label} color`}
        className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-40"
        value={HEX.test(props.value) ? props.value : "#888888"}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <label htmlFor={props.id} className="flex-1 font-medium">
        {props.label}
      </label>
      <SmallInput
        id={props.id}
        className="w-28 font-mono"
        maxLength={60}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  )
}

export function StylePanel(props: {
  readonly appearance: FormAppearance
  readonly problems: ReadonlyArray<{ readonly userMessage: string }>
  readonly onChange: ContentChange
  /** The preview's page; with light and dark colors, also which set is being edited. */
  readonly page: "dark" | "light"
  readonly onPage: (page: "dark" | "light") => void
}) {
  const { appearance } = props
  const [rulesText, setRulesText] = useState(() => rulesToText(appearance.rules))
  const setAppearance = (change: Partial<FormAppearance>) =>
    props.onChange((current) => ({ ...current, appearance: { ...current.appearance, ...change } }))
  // Fixed colors are one set; light and dark edits whichever mode the preview shows.
  const set: "colors" | "darkColors" =
    appearance.colorMode === "light-dark" && props.page === "dark" ? "darkColors" : "colors"
  const colors = appearance[set]
  const setColor = (key: keyof FormColors, value: string) =>
    props.onChange((current) => ({
      ...current,
      appearance: { ...current.appearance, [set]: { ...current.appearance[set], [key]: value } },
    }))
  const seeThrough = colors.background === "transparent"
  return (
    <div className="flex flex-col gap-5">
      <Fieldset
        legend="Colors"
        section
        info="Fixed: the same colors whatever the visitor's light or dark mode. Light and dark: one set for each, switching with the visitor's mode."
      >
        <SegmentedControl
          name="color-mode"
          label="Colors"
          options={COLOR_MODE_OPTIONS}
          value={appearance.colorMode}
          onChange={(colorMode) => setAppearance({ colorMode })}
        />
        {appearance.colorMode === "light-dark" ? (
          <SegmentedControl
            name="editing-mode"
            label="Editing"
            options={PAGE_OPTIONS}
            value={props.page}
            onChange={props.onPage}
          />
        ) : null}
        <div className="flex flex-col gap-2">
          {COLORS.map(([key, label]) => (
            <ColorRow
              key={key}
              id={`color-${set}-${key}`}
              label={label}
              value={colors[key]}
              onChange={(value) => setColor(key, value)}
            />
          ))}
          <ColorRow
            id={`color-${set}-background`}
            label="Background"
            value={seeThrough ? "" : colors.background}
            disabled={seeThrough}
            onChange={(value) => setColor("background", value)}
          />
          <div className="flex items-center gap-1">
            <Option>
              <Checkbox
                checked={seeThrough}
                onChange={(event) =>
                  setColor(
                    "background",
                    event.target.checked
                      ? "transparent"
                      : (set === "darkColors" ? DEFAULT_DARK_COLORS : DEFAULT_COLORS).background,
                  )
                }
              />
              See-through
            </Option>
            <InfoTip label="see-through">Shows the page behind the form instead of a background color.</InfoTip>
          </div>
        </div>
      </Fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Font"
          htmlFor="form-font"
          info="Any font the page already loads, or one from the font stylesheet below."
        >
          <Input
            id="form-font"
            maxLength={120}
            placeholder="System"
            value={appearance.fontFamily ?? ""}
            onChange={(event) => setAppearance({ fontFamily: event.target.value.trim() ? event.target.value : null })}
          />
        </Field>
        <Field label="Labels" htmlFor="form-labels">
          <Select
            id="form-labels"
            value={appearance.labels}
            onChange={(event) => setAppearance({ labels: event.target.value as FormAppearance["labels"] })}
          >
            <option value="above">Above</option>
            <option value="hidden">Hidden</option>
          </Select>
        </Field>
      </div>
      <FontStylesheetField value={appearance.fonts[0] ?? ""} onChange={(fonts) => setAppearance({ fonts })} />
      <Slider
        label="Corners"
        labelClassName="w-24 font-medium text-fg"
        min={0}
        max={24}
        step={1}
        value={appearance.radius}
        format={(n) => `${n}px`}
        onChange={(radius) => setAppearance({ radius })}
      />
      <Slider
        label="Spacing"
        labelClassName="w-24 font-medium text-fg"
        min={8}
        max={32}
        step={1}
        value={appearance.spacing}
        format={(n) => `${n}px`}
        onChange={(spacing) => setAppearance({ spacing })}
      />
      <Field
        label="Rules"
        htmlFor="form-rules"
        info={`CSS for the details colors and fonts don't cover, on ${Object.keys(APPEARANCE_CLASSES).join(", ")}, with ${APPEARANCE_STATES.join(", ")}.`}
      >
        <Textarea
          id="form-rules"
          rows={6}
          className="font-mono text-sm"
          spellCheck={false}
          placeholder={".Button {\n  text-transform: uppercase;\n}"}
          value={rulesText}
          onChange={(event) => {
            setRulesText(event.target.value)
            setAppearance({ rules: textToRules(event.target.value) })
          }}
        />
      </Field>
      {props.problems.length > 0 ? (
        <div className="flex flex-col gap-1">
          {props.problems.map((problem) => (
            <ErrorText key={problem.userMessage}>{problem.userMessage}</ErrorText>
          ))}
          <Hint>Changes save once the rules are fixed.</Hint>
        </div>
      ) : null}
    </div>
  )
}

/** A font stylesheet's address, kept as typed and saved once it's on a font service (FONT_HOSTS). */
function FontStylesheetField({
  value,
  onChange,
}: {
  readonly value: string
  readonly onChange: (fonts: ReadonlyArray<string>) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const valid = (address: string) => FONT_HOSTS.some((host) => address.startsWith(`https://${host}/`))
  return (
    <Field
      label="Font stylesheet"
      htmlFor="form-font-url"
      info={`A stylesheet that loads the font, such as https://fonts.googleapis.com/css2?family=Inter. From ${FONT_HOSTS.join(", ")}.`}
      error={text && !valid(text) ? `Use a stylesheet from ${FONT_HOSTS.join(", ")}.` : undefined}
    >
      <Input
        id="form-font-url"
        type="url"
        maxLength={500}
        placeholder="https://fonts.googleapis.com/css2?family=…"
        value={text}
        onChange={(event) => {
          const next = event.target.value.trim()
          setText(event.target.value)
          if (!next) onChange([])
          else if (valid(next)) onChange([next])
        }}
      />
    </Field>
  )
}
