export * as Logging from "./logging.ts"

import { Logger } from "effect"

export const layer = Logger.layer([Logger.consoleJson, Logger.tracerLogger])
