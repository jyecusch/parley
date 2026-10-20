/**
 * CRT settings (D81, D102, D114): how CRT mode looks, tuned per browser and kept in localStorage. The
 * phosphor colour drives the CSS palette through `--h` (hue) and `--crt-saturation` on <html>; the rest are
 * read by the shader on every draw, and the scanlines, vignette, flicker and glow also by the CSS layer.
 */
export interface CrtSettings {
  /** The phosphor's hue, 0–360 (OKLCH). */
  readonly hue: number
  /** How coloured the phosphor is, 0 (white) to 1. */
  readonly saturation: number
  /** How round the glass is, 0 (flat) to 1. */
  readonly curvature: number
  /** Chromatic aberration at the edges, 0–4 CSS pixels. */
  readonly aberration: number
  /** How dark the gaps between scanlines are, 0–1. */
  readonly scanlines: number
  /** Light spilling from bright strokes, 0–1. */
  readonly bloom: number
  /** How much the corners darken, 0–1. */
  readonly vignette: number
  /** The glow around text, 0–1. */
  readonly glow: number
  readonly flicker: boolean
}

export const CRT_DEFAULTS: CrtSettings = {
  hue: 72,
  saturation: 1,
  curvature: 0.5,
  aberration: 1,
  scanlines: 0.32,
  bloom: 0.22,
  vignette: 0.55,
  glow: 0.5,
  flicker: true,
}

/** Phosphors of real monitors, as starting points for the colour. */
export const PHOSPHORS: ReadonlyArray<{ readonly name: string; readonly hue: number; readonly saturation: number }> = [
  { name: "Amber", hue: 72, saturation: 1 },
  { name: "Green", hue: 145, saturation: 1 },
  { name: "Cyan", hue: 200, saturation: 0.8 },
  { name: "White", hue: 72, saturation: 0 },
]

const KEY = "parley.crt.settings"

const LIMITS: Readonly<Record<Exclude<keyof CrtSettings, "flicker">, readonly [number, number]>> = {
  hue: [0, 360],
  saturation: [0, 1],
  curvature: [0, 1],
  aberration: [0, 4],
  scanlines: [0, 1],
  bloom: [0, 1],
  vignette: [0, 1],
  glow: [0, 1],
}

const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback

const parse = (raw: string | null): CrtSettings => {
  let stored: Record<string, unknown> = {}
  try {
    const value: unknown = raw ? JSON.parse(raw) : {}
    if (value && typeof value === "object") stored = value as Record<string, unknown>
  } catch {
    // A damaged value falls back to the defaults.
  }
  const number = (key: keyof typeof LIMITS) => clamp(stored[key], LIMITS[key], CRT_DEFAULTS[key])
  return {
    hue: number("hue"),
    saturation: number("saturation"),
    curvature: number("curvature"),
    aberration: number("aberration"),
    scanlines: number("scanlines"),
    bloom: number("bloom"),
    vignette: number("vignette"),
    glow: number("glow"),
    flicker: typeof stored.flicker === "boolean" ? stored.flicker : CRT_DEFAULTS.flicker,
  }
}

const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Before D114 the glass was tuned with two keys of its own; their values carry over until the first save. */
const legacy = () => {
  try {
    const curvature = localStorage.getItem("parley.crt.curvature")
    const aberration = localStorage.getItem("parley.crt.aberration")
    if (curvature === null && aberration === null) return null
    return JSON.stringify({
      ...(curvature === null ? {} : { curvature: Number(curvature) }),
      ...(aberration === null ? {} : { aberration: Number(aberration) }),
    })
  } catch {
    return null
  }
}

let cached: { readonly raw: string | null; readonly settings: CrtSettings } | null = null

/** The current settings. Cheap enough to call on every frame. */
export const crtSettings = (): CrtSettings => {
  const raw = read() ?? legacy()
  if (!cached || cached.raw !== raw) cached = { raw, settings: parse(raw) }
  return cached.settings
}

/** Puts the phosphor colour and glow on <html>, where the CRT palette in app.css reads them. */
export const applyCrtSettings = (settings: CrtSettings = crtSettings()) => {
  const style = document.documentElement.style
  style.setProperty("--h", String(settings.hue))
  style.setProperty("--crt-saturation", String(settings.saturation))
  style.setProperty("--crt-glow", String(settings.glow))
  style.setProperty("--crt-scanlines", String(settings.scanlines / CRT_DEFAULTS.scanlines))
  style.setProperty("--crt-vignette", String(settings.vignette / CRT_DEFAULTS.vignette))
  style.setProperty("--crt-flicker", settings.flicker ? "1" : "0")
}

export const saveCrtSettings = (settings: CrtSettings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Private windows can refuse storage; the settings then last for this page only.
    cached = { raw: read(), settings }
  }
  applyCrtSettings(settings)
}

/**
 * The same as applyCrtSettings, as a script for the page head so the colour is right on first paint. Kept in
 * step with parse and applyCrtSettings by hand; it trusts the stored values less (only numbers pass).
 */
export const CRT_SETTINGS_SCRIPT = `try{var s=JSON.parse(localStorage.getItem("${KEY}")||"{}"),r=document.documentElement.style;if(typeof s.hue==="number")r.setProperty("--h",s.hue);if(typeof s.saturation==="number")r.setProperty("--crt-saturation",s.saturation);if(typeof s.glow==="number")r.setProperty("--crt-glow",s.glow);if(typeof s.scanlines==="number")r.setProperty("--crt-scanlines",s.scanlines/${CRT_DEFAULTS.scanlines});if(typeof s.vignette==="number")r.setProperty("--crt-vignette",s.vignette/${CRT_DEFAULTS.vignette});if(s.flicker===false)r.setProperty("--crt-flicker","0")}catch(e){}`
