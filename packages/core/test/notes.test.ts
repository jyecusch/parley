import { describe, expect, it } from "@effect/vitest"
import type { ApiKeyId } from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { CoreLive, type Principal, implementations as run } from "../src/index.ts"
import { Fixture } from "./fixture.ts"

describe("notes operations", () => {
  it.effect("authors edit their own notes; admins and authors delete; notes hide with their record", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      // A member of Acme who isn't an admin: a service account, through its own API key.
      const bot = yield* run["serviceAccounts.create"](f.jane, { teamId: f.acme, name: "Sync bot" })
      const botKey: Principal = {
        _tag: "ServiceAccountApiKey",
        userId: bot.id,
        name: DisplayName.fromRecord("Sync bot"),
        apiKeyId: "key_bot" as ApiKeyId,
        apiKeyName: "Nightly sync",
        scopes: new Set(["records:read", "records:write"]),
      }
      const contact = yield* run["contacts.create"](f.jane, { teamId: f.acme, firstName: "Ana" })
      const record = { teamId: f.acme, recordType: "contact" as const, recordId: contact.id }

      const janeNote = yield* run["notes.create"](f.jane, { ...record, body: "Called about the renewal." })
      expect(janeNote).toMatchObject({ authorName: "Jane", via: null, body: "Called about the renewal." })
      const botNote = yield* run["notes.create"](botKey, { ...record, body: "Synced from the old CRM." })
      expect(botNote).toMatchObject({ authorName: "Sync bot", via: "Nightly sync" })

      const listed = yield* run["notes.list"](f.jane, record)
      expect(listed.map((note) => note.id)).toEqual([janeNote.id, botNote.id])

      // Only the author edits.
      const notMine = yield* run["notes.update"](botKey, {
        teamId: f.acme,
        noteId: janeNote.id,
        body: "Hijacked",
      }).pipe(Effect.flip)
      expect(notMine).toMatchObject({ _tag: "NotNoteAuthor", author: "Jane" })
      const edited = yield* run["notes.update"](f.jane, {
        teamId: f.acme,
        noteId: janeNote.id,
        body: "Renewal agreed.",
      })
      expect(edited.body).toBe("Renewal agreed.")

      // A member can't delete someone else's note; an admin (Jane owns Acme) can.
      const denied = yield* run["notes.delete"](botKey, { teamId: f.acme, noteId: janeNote.id }).pipe(Effect.flip)
      expect(denied._tag).toBe("CannotDeleteOthersNote")
      yield* run["notes.delete"](f.jane, { teamId: f.acme, noteId: botNote.id })

      // Deleting the contact hides its notes; restoring brings them back.
      yield* run["contacts.delete"](f.jane, { teamId: f.acme, contactId: contact.id })
      const hidden = yield* run["notes.update"](f.jane, { teamId: f.acme, noteId: janeNote.id, body: "x" }).pipe(
        Effect.flip,
      )
      expect(hidden._tag).toBe("NoteNotFound")
      yield* run["contacts.restore"](f.jane, { teamId: f.acme, contactId: contact.id })
      const back = yield* run["notes.list"](f.jane, record)
      expect(back.map((note) => note.body)).toEqual(["Renewal agreed."])
    }).pipe(Effect.provide(CoreLive)),
  )

  it.effect("never reaches another team's records", () =>
    Effect.gen(function* () {
      const f = yield* Fixture
      const theirs = yield* run["companies.create"](f.bob, { teamId: f.globex, name: "Secret" })
      const crossTeam = yield* run["notes.create"](f.jane, {
        teamId: f.acme,
        recordType: "company",
        recordId: theirs.id,
        body: "Peek",
      }).pipe(Effect.flip)
      expect(crossTeam._tag).toBe("CompanyNotFound")
      const readOnly = yield* run["notes.create"](f.janeReadOnlyKey, {
        teamId: f.acme,
        recordType: "company",
        recordId: theirs.id,
        body: "Nope",
      }).pipe(Effect.flip)
      expect(readOnly._tag).toBe("ApiKeyScopeExcludes")
    }).pipe(Effect.provide(CoreLive)),
  )
})
