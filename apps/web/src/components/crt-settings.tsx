import { useState } from "react"
import { CRT_DEFAULTS, type CrtSettings, crtSettings, PHOSPHORS, saveCrtSettings } from "../lib/crt-settings.ts"
import { Button, Checkbox, cn, Dialog, Fieldset, Hint, Option, Slider } from "./ui/index.ts"

/** The colour a phosphor draws in, as CRT mode's foreground (app.css) would with these settings. */
const phosphorColor = (hue: number, saturation: number) => `oklch(0.88 ${0.16 * saturation} ${hue})`

/**
 * CRT settings (D114): the phosphor colour and how strong each part of the effect is. Every change shows at
 * once, behind the dialog, and is kept in this browser.
 */
export function CrtSettingsDialog(props: { readonly crtOn: boolean; readonly onClose: () => void }) {
  const [settings, setSettings] = useState<CrtSettings>(crtSettings)
  const change = (next: Partial<CrtSettings>) => {
    const updated = { ...settings, ...next }
    setSettings(updated)
    saveCrtSettings(updated)
  }
  const percent = (key: "scanlines" | "bloom" | "vignette" | "glow" | "curvature") => ({
    value: settings[key],
    onChange: (value: number) => change({ [key]: value }),
  })

  return (
    <Dialog
      title="CRT settings"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => change(CRT_DEFAULTS)}>
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </>
      }
    >
      {props.crtOn ? null : <Hint>CRT mode is off. Turn it on to see these settings.</Hint>}

      <Fieldset legend="Phosphor">
        <div className="mb-2 flex flex-wrap gap-2">
          {PHOSPHORS.map((phosphor) => {
            const chosen = phosphor.hue === settings.hue && phosphor.saturation === settings.saturation
            return (
              <Button
                key={phosphor.name}
                aria-pressed={chosen}
                className={cn(chosen && "inset-ring-2 inset-ring-fg")}
                onClick={() => change({ hue: phosphor.hue, saturation: phosphor.saturation })}
              >
                <span
                  aria-hidden="true"
                  className="size-3.5 rounded-full"
                  style={{ backgroundColor: phosphorColor(phosphor.hue, phosphor.saturation) }}
                />
                {phosphor.name}
              </Button>
            )
          })}
        </div>
        <Slider
          label="Hue"
          min={0}
          max={360}
          step={1}
          format={(value) => `${Math.round(value)}°`}
          value={settings.hue}
          onChange={(hue) => change({ hue })}
        />
        <Slider label="Saturation" value={settings.saturation} onChange={(saturation) => change({ saturation })} />
        <Slider label="Text glow" {...percent("glow")} />
      </Fieldset>

      <Fieldset legend="Glass">
        <Slider label="Curvature" {...percent("curvature")} />
        <Slider
          label="Chromatic aberration"
          min={0}
          max={4}
          step={0.1}
          format={(value) => value.toFixed(1)}
          value={settings.aberration}
          onChange={(aberration) => change({ aberration })}
        />
      </Fieldset>

      <Fieldset legend="Picture">
        <Slider label="Scanlines" {...percent("scanlines")} />
        <Slider label="Bloom" {...percent("bloom")} />
        <Slider label="Vignette" {...percent("vignette")} />
        <Option className="mt-1">
          <Checkbox checked={settings.flicker} onChange={(event) => change({ flicker: event.target.checked })} />
          Flicker
        </Option>
      </Fieldset>
    </Dialog>
  )
}
