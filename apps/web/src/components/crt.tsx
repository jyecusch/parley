import { type ReactNode, type RefCallback, useCallback, useEffect, useRef, useState } from "react"

/**
 * CRT mode (D81). Where the browser can draw HTML into a canvas (HTML-in-Canvas) and has WebGL 2, the app is
 * moved into a `<canvas layoutsubtree>` and drawn through a CRT shader. The DOM stays live inside the canvas,
 * so clicks, focus, selection and typing keep working. Everywhere else, the CSS layer draws the same effect over
 * the app. With CRT mode off there is no canvas, no timer and no WebGL context.
 */
export function useCrt(): { readonly screenRef: RefCallback<HTMLElement>; readonly overlay: ReactNode } {
  const on = useCrtMode()
  const still = useReducedMotion()
  const [screen, setScreen] = useState<HTMLElement | null>(null)
  const [shaderFailed, setShaderFailed] = useState(false)
  const unmountShader = useRef<(() => void) | null>(null)

  const screenRef = useCallback<RefCallback<HTMLElement>>((element) => {
    setScreen(element)
    // Ref cleanups run before React removes the element, so it is back in its own parent by then.
    return () => {
      unmountShader.current?.()
      setScreen(null)
    }
  }, [])

  const shaderOn = on && screen !== null && !shaderFailed && shaderSupported()
  useEffect(() => {
    if (!shaderOn || !screen) return
    const unmount = mountShader(screen, { still, onFail: () => setShaderFailed(true) })
    if (!unmount) {
      setShaderFailed(true)
      return
    }
    unmountShader.current = unmount
    return () => {
      unmount()
      unmountShader.current = null
    }
  }, [shaderOn, screen, still])

  return { screenRef, overlay: on && !shaderOn ? <CssLayer /> : null }
}

/** The CSS layer: pointer-transparent, over the real UI, for browsers that can't run the shader. */
function CssLayer() {
  return (
    <div className="crt-fx" aria-hidden="true">
      <div className="crt-mask" />
      <div className="crt-scan" />
      <div className="crt-flicker" />
      <div className="crt-vig" />
    </div>
  )
}

const useCrtMode = () => {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const update = () => setOn(document.documentElement.dataset.crt === "amber")
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-crt"] })
    return () => observer.disconnect()
  }, [])
  return on
}

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return reduced
}

/** HTML-in-Canvas, which is not in the TypeScript DOM types yet. */
interface ElementGl extends WebGL2RenderingContext {
  texElementImage2D(target: GLenum, internalformat: GLenum, element: Element): void
}
interface ElementCanvas extends HTMLCanvasElement {
  requestPaint(): void
  /** Makes a drawn child hit-testable where it was drawn; without it, the canvas takes every pointer event. */
  updateElementGeometry(element: Element, transform?: DOMMatrix): void
}

const shaderSupported = () =>
  "layoutSubtree" in HTMLCanvasElement.prototype &&
  typeof WebGL2RenderingContext !== "undefined" &&
  "texElementImage2D" in WebGL2RenderingContext.prototype

/**
 * The glass, tunable per browser in localStorage (D102): `parley.crt.curvature` (0 flat to 1 very round,
 * default 0.5) and `parley.crt.aberration` (colour fringing at the edges in CSS pixels, 0 to 4, default 1).
 * Read on every draw, so a change shows on the next repaint.
 */
const readSetting = (key: string, fallback: number, max: number) => {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : fallback
  } catch {
    return fallback
  }
}
const glassSettings = () => ({
  /** The barrel factor: 0.5 bows the screen edges in by about 1.5% of the width. */
  curvature: readSetting("parley.crt.curvature", 0.5, 1) * 0.24,
  aberration: readSetting("parley.crt.aberration", 1, 4),
})

/** Where the shader samples the app for a point on the glass: the same barrel mapping as the fragment shader. */
const barrel = (x: number, y: number, width: number, height: number, curvature: number) => {
  const cx = x / width - 0.5
  const cy = y / height - 0.5
  const bulge = 1 + curvature * (cx * cx + cy * cy)
  return { x: (0.5 + cx * bulge) * width, y: (0.5 + cy * bulge) * height }
}

/** How long the app may stay undrawn after it moves into the canvas before the CSS layer takes over. */
const FIRST_PAINT_TIMEOUT_MS = 1500

/**
 * Moves `screen` into a CRT canvas and draws it through the shader on every paint of its subtree. Returns the
 * function that puts `screen` back, or null when WebGL can't start. `onFail` reports a later failure, after which
 * the caller should unmount and fall back to the CSS layer.
 */
function mountShader(screen: HTMLElement, options: { readonly still: boolean; readonly onFail: () => void }) {
  const home = screen.parentNode
  if (!home) return null
  const parent: ParentNode = home
  const canvas = document.createElement("canvas") as ElementCanvas
  canvas.className = "crt-screen"
  canvas.setAttribute("layoutsubtree", "")
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false })
  const program = gl ? createProgram(gl) : null
  if (!gl || !program) return null
  const elementGl = gl as ElementGl

  const uniform = (name: string) => gl.getUniformLocation(program, name)
  const uSize = uniform("u_size")
  const uExtent = uniform("u_extent")
  const uFlicker = uniform("u_flicker")
  const uCurvature = uniform("u_curvature")
  const uAberration = uniform("u_aberration")
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
  gl.useProgram(program)
  gl.uniform1i(uniform("u_screen"), 0)
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  let drawn = false
  let unmounted = false
  let flickerTimer: ReturnType<typeof setTimeout> | undefined

  const draw = () => {
    if (!drawn) return
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(uSize, canvas.clientWidth, canvas.clientHeight)
    gl.uniform2f(
      uExtent,
      screen.offsetWidth / Math.max(canvas.clientWidth, 1),
      screen.offsetHeight / Math.max(canvas.clientHeight, 1),
    )
    gl.uniform1f(uFlicker, options.still ? 1 : flickerAt(performance.now()))
    const glass = glassSettings()
    gl.uniform1f(uCurvature, glass.curvature)
    gl.uniform1f(uAberration, glass.aberration)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const fail = () => {
    unmount()
    options.onFail()
  }

  /*
   * The glass bends the picture but the browser hit-tests the flat app. Hit-testing can only be moved by a
   * matrix, so on every pointer move the app's hit geometry is shifted by how far the bend moves the point
   * under the pointer. Near the pointer, what you see is then what you click.
   */
  let hitShift = { x: 0, y: 0 }
  const hitGeometry = () => new DOMMatrix().translate(hitShift.x, hitShift.y)
  const onPointer = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const seen = barrel(x, y, box.width, box.height, glassSettings().curvature)
    const next = { x: x - seen.x, y: y - seen.y }
    if (Math.abs(next.x - hitShift.x) < 0.5 && Math.abs(next.y - hitShift.y) < 0.5) return
    hitShift = next
    try {
      canvas.updateElementGeometry(screen, hitGeometry())
    } catch {
      fail()
    }
  }

  const onPaint = () => {
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      elementGl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, screen)
      gl.generateMipmap(gl.TEXTURE_2D)
      canvas.updateElementGeometry(screen, hitGeometry())
    } catch {
      fail()
      return
    }
    drawn = true
    draw()
  }

  const flicker = () => {
    draw()
    flickerTimer = setTimeout(flicker, msToNextFlicker(performance.now()))
  }

  const resizer = new ResizeObserver(([entry]) => {
    const device = entry?.devicePixelContentBoxSize?.[0]
    canvas.width = device ? device.inlineSize : Math.round(canvas.clientWidth * devicePixelRatio)
    canvas.height = device ? device.blockSize : Math.round(canvas.clientHeight * devicePixelRatio)
    canvas.requestPaint()
  })

  const firstPaint = setTimeout(() => {
    if (!drawn) fail()
  }, FIRST_PAINT_TIMEOUT_MS)

  function unmount() {
    if (unmounted) return
    unmounted = true
    clearTimeout(firstPaint)
    clearTimeout(flickerTimer)
    resizer.disconnect()
    canvas.removeEventListener("paint", onPaint)
    window.removeEventListener("pointermove", onPointer, true)
    window.removeEventListener("pointerdown", onPointer, true)
    canvas.removeEventListener("webglcontextlost", fail)
    const canvasParent = canvas.parentNode
    if (canvasParent) moveInto(canvasParent, screen, canvas)
    else moveInto(parent, screen, null)
    canvas.remove()
    elementGl.getExtension("WEBGL_lose_context")?.loseContext()
  }

  canvas.addEventListener("paint", onPaint)
  canvas.addEventListener("webglcontextlost", fail)
  // Capture phase, so the shift is in place before the next event is hit-tested.
  window.addEventListener("pointermove", onPointer, { capture: true, passive: true })
  window.addEventListener("pointerdown", onPointer, { capture: true, passive: true })
  parent.insertBefore(canvas, screen)
  moveInto(canvas, screen, null)
  resizer.observe(canvas, { box: "device-pixel-content-box" })
  if (!options.still) flicker()
  return unmount
}

/** Moves `node` keeping its focus and scroll positions where the browser supports `moveBefore`. */
const moveInto = (parent: ParentNode, node: Element, before: Node | null) => {
  if (typeof parent.moveBefore === "function") {
    parent.moveBefore(node, before)
    return
  }
  const focused = document.activeElement
  parent.insertBefore(node, before)
  if (focused instanceof HTMLElement && node.contains(focused)) focused.focus({ preventScroll: true })
}

/** The flicker matches the CSS layer's `crt-flicker` keyframes: a 5s cycle with two short dips. */
const FLICKER_CYCLE_MS = 5000
const FLICKER_STEPS: ReadonlyArray<readonly [end: number, opacity: number]> = [
  [0.31, 1],
  [0.32, 0.4],
  [0.74, 1],
  [0.75, 0.6],
  [1, 1],
]

const flickerAt = (now: number) => {
  const phase = (now % FLICKER_CYCLE_MS) / FLICKER_CYCLE_MS
  return FLICKER_STEPS.find(([end]) => phase < end)?.[1] ?? 1
}

const msToNextFlicker = (now: number) => {
  const phase = (now % FLICKER_CYCLE_MS) / FLICKER_CYCLE_MS
  const end = FLICKER_STEPS.find(([stepEnd]) => phase < stepEnd)?.[0] ?? 1
  return (end - phase) * FLICKER_CYCLE_MS + 1
}

const VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
  // One triangle that covers the viewport; v_uv runs 0..1 from the top-left corner.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = vec2(corner.x, 1.0 - corner.y);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`

/*
 * The CRT shader, amber phosphor. Mask, scanlines, flicker, vignette and edge light mirror the CSS layer in
 * app.css. The shader adds what CSS can't: the convex glass (barrel curvature, a curved bezel and a soft
 * reflection), chromatic aberration towards the edges, and bloom. There is no rolling band (D81).
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_screen;
uniform vec2 u_size;    // canvas size in CSS pixels
uniform vec2 u_extent;  // app size over canvas size; above 1 when the app overflows the viewport
uniform float u_flicker;
uniform float u_curvature;   // barrel factor; 0 is flat
uniform float u_aberration;  // colour fringing at the edges, in CSS pixels
in vec2 v_uv;
out vec4 frag;

const float RADIUS = 22.0;
const vec3 GLASS = vec3(0.012, 0.009, 0.006);
const vec3 AMBER = vec3(1.0, 0.76, 0.36);
const vec3 WASH = vec3(0.98, 0.86, 0.64);

vec3 screenBlend(vec3 base, vec3 light) {
  return 1.0 - (1.0 - base) * (1.0 - light);
}

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 centered = v_uv - 0.5;
  // Barrel: the glass bulges, so the picture bows in and the bezel shows at the edges.
  vec2 uv = 0.5 + centered * (1.0 + u_curvature * dot(centered, centered));
  vec2 px = uv * u_size;

  // Rounded glass: signed distance to the screen edge in CSS pixels, negative inside.
  vec2 q = abs(px - u_size * 0.5) - (u_size * 0.5 - RADIUS);
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - RADIUS;
  if (edge > 1.0) {
    frag = vec4(GLASS, 1.0);
    return;
  }

  vec2 texel = uv / u_extent;
  // Chromatic aberration: red and blue land slightly apart, more towards the edges, none in the middle.
  vec2 fringe = (uv - 0.5) * 2.0 * u_aberration / u_size / u_extent;
  vec3 color = vec3(
    texture(u_screen, texel + fringe).r,
    texture(u_screen, texel).g,
    texture(u_screen, texel - fringe).b
  );

  // Bloom: phosphor light spilling from the brightest strokes.
  vec3 glow = textureLod(u_screen, texel, 2.5).rgb * 0.6 + textureLod(u_screen, texel, 4.5).rgb * 0.4;
  color = screenBlend(color, glow * 0.22);

  // Aperture mask: a 3px red, green, blue triad.
  float column = mod(floor(px.x), 3.0);
  vec3 mask = column < 1.0 ? vec3(0.8, 0.22, 0.26) * 0.05
    : column < 2.0 ? vec3(0.3, 0.7, 0.3) * 0.04
    : vec3(0.24, 0.32, 0.86) * 0.05;
  color = screenBlend(color, mask);

  // Scanlines: every third pixel row darkens; bright phosphor bleeds into the gap.
  float row = fract(px.y / 3.0);
  float gap = smoothstep(0.6, 0.7, row) * (1.0 - smoothstep(0.96, 1.0, row));
  color *= 1.0 - 0.32 * gap * (1.0 - 0.35 * luma(color));

  // Flicker: a faint amber wash that dips twice every five seconds.
  color = mix(color, WASH, 0.015 * u_flicker);

  // Vignette: the elliptical falloff plus the soft inner shadow of the CSS layer.
  float ellipse = length(centered / vec2(0.75, 0.7));
  color *= 1.0 - 0.55 * clamp((ellipse - 0.6) / 0.4, 0.0, 1.0);
  vec2 inset = min(px, u_size - px);
  vec2 shadow = 0.65 * (0.5 - 0.5 * tanh(0.8 * inset / 45.0));
  color *= (1.0 - shadow.x) * (1.0 - shadow.y);

  // Reflection: the convex glass catches a soft light from the upper left.
  vec2 light = (v_uv - vec2(0.3, 0.22)) / vec2(0.55, 0.4);
  color = screenBlend(color, WASH * 0.035 * (1.0 - smoothstep(0.0, 1.0, length(light))) * (0.5 + 2.0 * u_curvature));

  // Edge light: a 1px amber line along the glass.
  color = mix(color, AMBER, 0.08 * smoothstep(-2.0, -1.0, edge));
  color = mix(color, GLASS, smoothstep(0.0, 1.0, edge));

  frag = vec4(color, 1.0);
}`

const createProgram = (gl: WebGL2RenderingContext) => {
  const compile = (type: GLenum, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null
}
