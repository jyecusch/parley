/** Most requests are small; only images and CSV imports carry real payloads. */
const DEFAULT_LIMIT = 1024 * 1024
const LARGE_LIMIT = 16 * 1024 * 1024
const LARGE = /\/(avatar|logo|import)$/
/** imports.start takes a file of up to 100,000 rows (D135). */
const IMPORT_LIMIT = 32 * 1024 * 1024
const IMPORTS = /\/teams\/[^/]+\/imports$/

const tooLarge = (limit: number) =>
  new Response(
    JSON.stringify({
      _tag: "PayloadTooLarge",
      error: {
        _tag: "RequestTooLarge",
        userMessage: `This request is too big. The limit is ${Math.round(limit / 1024 / 1024)} MB.`,
        isRetryable: false,
      },
    }),
    { status: 413, headers: { "content-type": "application/json" } },
  )

/**
 * Caps a request's body before anything reads it, so nobody can make the server buffer a huge body
 * (they'd be refused only after it was read and parsed). A declared length over the cap is refused at
 * once; a body without one is cut off as it streams past the cap.
 */
export const limitBody = (request: Request): Request | Response => {
  if (!request.body) return request
  const path = new URL(request.url).pathname
  const limit = IMPORTS.test(path) ? IMPORT_LIMIT : LARGE.test(path) ? LARGE_LIMIT : DEFAULT_LIMIT
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) return tooLarge(limit)
  let seen = 0
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength
        if (seen > limit) controller.error(new Error("request body over the limit"))
        else controller.enqueue(chunk)
      },
    }),
  )
  // Built from its parts: the server's own request object refuses to be copied once its body is taken.
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: counted,
    signal: request.signal,
    duplex: "half",
  } as RequestInit)
}
