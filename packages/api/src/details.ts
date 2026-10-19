import type { OperationError, OperationName, Operations } from "@parley/domain"

type AnyOperationError = { [Name in OperationName]: OperationError<Operations[Name]> }[OperationName]

/**
 * The typed context an agent or the UI can act on, per error tag (D44). Never produced by
 * encoding the error class, so nothing leaks by accident.
 */
export const detailsOf = (error: AnyOperationError): unknown => {
  switch (error._tag) {
    case "ContactEmailTaken":
      return { existing: error.existing }
    case "RoleLacksPermission":
    case "ApiKeyScopeExcludes":
      return { needed: error.needed }
    case "InputRejected":
      return { problems: error.problems }
    case "ContactNotFound":
      return { contactId: error.contactId }
    default:
      return undefined
  }
}

export type { AnyOperationError }
