import { Database, schema } from "@parley/db"
import {
  type DatabaseUnavailable,
  type DnsRecord,
  type EmailError,
  normalizeDomain,
  type Sender,
  SenderAddressNotOnSendingDomain,
  type SenderId,
  SenderIsDefault,
  SenderNotReady,
  type SendingDomain,
  type SendingDomainId,
  SendingDomainLimitReached,
  SendingDomainTaken,
  type TeamId,
} from "@parley/domain"
import { DisplayName, EchoedInput } from "@parley/errors"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { Mailer } from "../mail/mailer.ts"
import type { CanManageEmail, MemberOf } from "../proofs/permissions.ts"
import type { SenderInTeam } from "../proofs/sender-in-team.ts"
import type { SendingDomainInTeam } from "../proofs/sending-domain-in-team.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

export interface SenderInput {
  readonly name: string
  readonly address: string
  readonly replyTo?: string | null | undefined
  readonly legalName: string
  readonly postalAddress: string
}

/** A change to a sender: undefined leaves a value as it is. */
export type SenderChanges = { readonly [K in keyof SenderInput]?: SenderInput[K] | undefined }

/** Who an email is from, and its footer, as sent (R40). Copied onto a broadcast when it starts. */
export interface SendAs {
  readonly from: string
  readonly replyTo: string | null
  readonly legalName: string
  readonly postalAddress: string
}

/** A footer's sender details, for a preview. */
export interface FooterSender {
  readonly legalName: string
  readonly postalAddress: string
}

/** How many sending domains a team may have; each is registered with the email provider. */
const DOMAIN_LIMIT = 5
/** How long an unverified domain stays claimed before another team may take it. */
const CLAIM_DAYS = 3

const domainOf = (address: string | null) => (address ? (address.split("@")[1]?.toLowerCase() ?? "") : "")

/** A display name in a From header, quoted when it needs to be. */
const fromHeader = (name: string, address: string) =>
  /^[\w .'-]+$/.test(name) ? `${name} <${address}>` : `"${name.replace(/["\\\r\n]/g, "")}" <${address}>`

/** A team's senders and sending domains (R40, R44, D162). Process tier: the team is passed per call. */
export class Sending extends Context.Service<
  Sending,
  {
    readonly senders: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<Sender>, DatabaseUnavailable>
    /** Used only by the SenderInTeam provers. */
    readonly locateSender: (teamId: TeamId, id: SenderId) => Effect.Effect<Sender | undefined, DatabaseUnavailable>
    readonly createSender: <P, T>(
      access: CanManageEmail<P, T>,
      input: SenderInput & { readonly isDefault?: boolean | undefined },
    ) => Effect.Effect<Sender, SenderAddressNotOnSendingDomain | DatabaseUnavailable>
    readonly updateSender: <P, T, S>(
      target: SenderInTeam<S, T>,
      input: SenderChanges,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<Sender, SenderAddressNotOnSendingDomain | DatabaseUnavailable>
    readonly setDefaultSender: <P, T, S>(
      target: SenderInTeam<S, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<Sender, DatabaseUnavailable>
    /** Drafts and forms that sent from it fall back to the default, as does anything naming a sender that's gone. */
    readonly deleteSender: <P, T, S>(
      target: SenderInTeam<S, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<Sender, SenderIsDefault | DatabaseUnavailable>
    /** Who an email goes out as: the sender named, else (or if it's gone) the default; or what's missing. */
    readonly sendAs: <P, T>(
      member: MemberOf<P, T>,
      senderId: SenderId | null,
    ) => Effect.Effect<SendAs, SenderNotReady | DatabaseUnavailable>
    /**
     * The same for a form's confirmation email (D146), or undefined when there's no ready sender.
     * Process tier, for the public form runtime, which has no member: it only reads what's sent.
     */
    readonly sendAsForTeam: (
      teamId: TeamId,
      senderId: SenderId | null,
    ) => Effect.Effect<SendAs | undefined, DatabaseUnavailable>
    /** The footer details of the sender named, else the default, ready or not; undefined if the team has none. */
    readonly footerSender: (
      teamId: TeamId,
      senderId: SenderId | null,
    ) => Effect.Effect<FooterSender | undefined, DatabaseUnavailable>
    readonly domains: <P, T>(member: MemberOf<P, T>) => Effect.Effect<ReadonlyArray<SendingDomain>, DatabaseUnavailable>
    /** Used only by the SendingDomainInTeam prover. */
    readonly locateDomain: (
      teamId: TeamId,
      id: SendingDomainId,
    ) => Effect.Effect<SendingDomain | undefined, DatabaseUnavailable>
    readonly addDomain: <P, T>(
      access: CanManageEmail<P, T>,
      domain: string,
    ) => Effect.Effect<SendingDomain, SendingDomainTaken | SendingDomainLimitReached | EmailError | DatabaseUnavailable>
    readonly verifyDomain: <P, T, D>(
      target: SendingDomainInTeam<D, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<SendingDomain, EmailError | DatabaseUnavailable>
    readonly removeDomain: <P, T, D>(
      target: SendingDomainInTeam<D, T>,
      access: CanManageEmail<P, T>,
    ) => Effect.Effect<SendingDomain, EmailError | DatabaseUnavailable>
  }
>()("@parley/core/Sending") {
  static readonly layer = Layer.effect(
    Sending,
    Effect.gen(function* () {
      const db = yield* Database
      const mailer = yield* Mailer
      const run = <A>(effect: Effect.Effect<A, SqlError.SqlError>) =>
        effect.pipe(Effect.catchTag("SqlError", classifySqlError))

      const toDomain = (row: typeof schema.sendingDomains.$inferSelect): SendingDomain => ({
        id: row.id as SendingDomainId,
        domain: row.domain,
        status: row.status,
        records: row.records as Array<DnsRecord>,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })

      const domainsOf = (teamId: TeamId) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.sendingDomains)
              .where(eq(schema.sendingDomains.teamId, teamId))
              .orderBy(asc(schema.sendingDomains.domain)),
          ),
        ).pipe(Effect.map((rows) => rows.map(toDomain)))

      type SenderRow = typeof schema.senders.$inferSelect

      const senderRows = (teamId: TeamId) =>
        run(
          db.query((d) =>
            d
              .select()
              .from(schema.senders)
              .where(eq(schema.senders.teamId, teamId))
              .orderBy(desc(schema.senders.isDefault), asc(schema.senders.name), asc(schema.senders.address)),
          ),
        )

      const verifiedOf = (teamId: TeamId) =>
        Effect.map(
          domainsOf(teamId),
          (domains) => new Set(domains.filter((entry) => entry.status === "verified").map((entry) => entry.domain)),
        )

      /**
       * How many forms and draft broadcasts send from each sender. Those naming none, or a sender
       * that's gone, count for the default. Sent broadcasts keep their own copy.
       */
      const usageOf = (teamId: TeamId, rows: ReadonlyArray<SenderRow>) =>
        Effect.gen(function* () {
          const [forms, broadcasts] = yield* Effect.all([
            run(
              db.query((d) =>
                d
                  .select({
                    senderId: sql<
                      string | null
                    >`coalesce(${schema.forms.published}, ${schema.forms.draft})->>'senderId'`,
                    count: sql<number>`count(*)::int`,
                  })
                  .from(schema.forms)
                  .where(and(eq(schema.forms.teamId, teamId), isNull(schema.forms.deletedAt)))
                  .groupBy(sql`1`),
              ),
            ),
            run(
              db.query((d) =>
                d
                  .select({ senderId: schema.broadcasts.senderId, count: sql<number>`count(*)::int` })
                  .from(schema.broadcasts)
                  .where(and(eq(schema.broadcasts.teamId, teamId), eq(schema.broadcasts.status, "draft")))
                  .groupBy(schema.broadcasts.senderId),
              ),
            ),
          ])
          const ids = new Set(rows.map((row) => row.id))
          const fallback = rows.find((row) => row.isDefault)?.id
          const usage = new Map(rows.map((row) => [row.id, { forms: 0, broadcasts: 0 }]))
          const add = (senderId: string | null, kind: "forms" | "broadcasts", count: number) => {
            const id = senderId && ids.has(senderId) ? senderId : fallback
            const entry = id ? usage.get(id) : undefined
            if (entry) entry[kind] += Number(count)
          }
          for (const row of forms) add(row.senderId, "forms", row.count)
          for (const row of broadcasts) add(row.senderId, "broadcasts", row.count)
          return usage
        })

      const toSender = (
        row: SenderRow,
        verified: ReadonlySet<string>,
        usedBy: { readonly forms: number; readonly broadcasts: number },
      ): Sender => ({
        id: row.id as SenderId,
        name: row.name,
        address: row.address,
        replyTo: row.replyTo,
        legalName: row.legalName,
        postalAddress: row.postalAddress,
        isDefault: row.isDefault,
        ready: verified.has(domainOf(row.address)),
        usedBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })

      const sendersOf = (teamId: TeamId) =>
        Effect.gen(function* () {
          const [rows, verified] = yield* Effect.all([senderRows(teamId), verifiedOf(teamId)])
          const usage = yield* usageOf(teamId, rows)
          return rows.map((row) => toSender(row, verified, usage.get(row.id) ?? { forms: 0, broadcasts: 0 }))
        })

      const oneSender = (teamId: TeamId, id: string) =>
        Effect.map(sendersOf(teamId), (all) => all.find((sender) => sender.id === id))

      /** The sender named, else (or if it's gone) the team's default. */
      const chosenRow = (teamId: TeamId, senderId: SenderId | null) =>
        Effect.map(
          senderRows(teamId),
          (rows) =>
            (senderId ? rows.find((row) => row.id === senderId) : undefined) ?? rows.find((row) => row.isDefault),
        )

      const sendAsOf = (row: SenderRow): SendAs => ({
        from: fromHeader(row.name, row.address),
        replyTo: row.replyTo,
        legalName: row.legalName,
        postalAddress: row.postalAddress,
      })

      /** A sender's address must be on one of the team's sending domains, verified or not yet. */
      const checkAddress = (teamId: TeamId, address: string) =>
        Effect.gen(function* () {
          const domains = yield* domainsOf(teamId)
          if (!domains.some((entry) => entry.domain === domainOf(address))) {
            return yield* new SenderAddressNotOnSendingDomain({ address: EchoedInput.fromRequest(address) })
          }
        })

      const makeDefault = (teamId: TeamId, id: string) =>
        // Clear the old default first: the partial unique index allows one default per team.
        db.transaction(
          Effect.gen(function* () {
            yield* db.query((d) =>
              d
                .update(schema.senders)
                .set({ isDefault: false, updatedAt: sql`now()` })
                .where(and(eq(schema.senders.teamId, teamId), eq(schema.senders.isDefault, true))),
            )
            yield* db.query((d) =>
              d
                .update(schema.senders)
                .set({ isDefault: true, updatedAt: sql`now()` })
                .where(and(eq(schema.senders.teamId, teamId), eq(schema.senders.id, id))),
            )
          }),
        )

      const createSender = <P, T>(
        access: CanManageEmail<P, T>,
        input: SenderInput & { readonly isDefault?: boolean | undefined },
      ) =>
        Effect.gen(function* () {
          const teamId = access.member.team.value
          yield* checkAddress(teamId, input.address)
          const id = crypto.randomUUID()
          // The team's first sender is its default; is_default only when no other row has it.
          yield* run(
            db.query((d) =>
              d.execute(sql`
                insert into "senders" (id, team_id, name, address, reply_to, legal_name, postal_address, is_default)
                values (${id}, ${teamId}, ${input.name}, ${input.address.toLowerCase()}, ${input.replyTo ?? null},
                  ${input.legalName}, ${input.postalAddress},
                  not exists (select 1 from "senders" where team_id = ${teamId} and is_default))`),
            ),
          )
          if (input.isDefault) yield* run(makeDefault(teamId, id))
          return (yield* oneSender(teamId, id)) as Sender
        }).pipe(Effect.withSpan("Sending.createSender"))

      const updateSender = <T, S>(target: SenderInTeam<S, T>, input: SenderChanges) =>
        Effect.gen(function* () {
          const teamId = target.team.value
          if (input.address !== undefined) yield* checkAddress(teamId, input.address)
          yield* run(
            db.query((d) =>
              d
                .update(schema.senders)
                .set({
                  ...(input.name !== undefined ? { name: input.name } : {}),
                  ...(input.address !== undefined ? { address: input.address.toLowerCase() } : {}),
                  ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
                  ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
                  ...(input.postalAddress !== undefined ? { postalAddress: input.postalAddress } : {}),
                  updatedAt: sql`now()`,
                })
                .where(and(eq(schema.senders.teamId, teamId), eq(schema.senders.id, target.sender.value))),
            ),
          )
          return (yield* oneSender(teamId, target.sender.value)) ?? target.found
        }).pipe(Effect.withSpan("Sending.updateSender"))

      const setDefaultSender = <T, S>(target: SenderInTeam<S, T>) =>
        Effect.gen(function* () {
          yield* run(makeDefault(target.team.value, target.sender.value))
          return (yield* oneSender(target.team.value, target.sender.value)) ?? target.found
        }).pipe(Effect.withSpan("Sending.setDefaultSender"))

      const deleteSender = <T, S>(target: SenderInTeam<S, T>) =>
        Effect.gen(function* () {
          if (target.found.isDefault) {
            return yield* new SenderIsDefault({ sender: DisplayName.fromRecord(target.found.name) })
          }
          const teamId = target.team.value
          const id = target.sender.value
          // Draft broadcasts let go of it on their own (on delete set null). Forms name it in their
          // content, so their draft and live content go back to the default too. Published versions
          // keep it, and fall back to the default when they send a confirmation.
          yield* run(
            db.transaction(
              Effect.gen(function* () {
                yield* db.query((d) =>
                  d.execute(sql`
                    update "forms" set
                      draft = case when draft->>'senderId' = ${id} then jsonb_set(draft, '{senderId}', 'null') else draft end,
                      published = case when published->>'senderId' = ${id} then jsonb_set(published, '{senderId}', 'null') else published end
                    where team_id = ${teamId} and (draft->>'senderId' = ${id} or published->>'senderId' = ${id})`),
                )
                yield* db.query((d) =>
                  d
                    .delete(schema.senders)
                    .where(
                      and(
                        eq(schema.senders.teamId, teamId),
                        eq(schema.senders.id, id),
                        eq(schema.senders.isDefault, false),
                      ),
                    ),
                )
              }),
            ),
          )
          return target.found
        }).pipe(Effect.withSpan("Sending.deleteSender"))

      const sendAs = <P, T>(member: MemberOf<P, T>, senderId: SenderId | null) =>
        Effect.gen(function* () {
          const teamId = member.team.value
          const [row, verified] = yield* Effect.all([chosenRow(teamId, senderId), verifiedOf(teamId)])
          if (!row) return yield* new SenderNotReady({ team: member.teamName, missing: "sender" })
          if (!verified.has(domainOf(row.address))) {
            return yield* new SenderNotReady({ team: member.teamName, missing: "verified-domain" })
          }
          return sendAsOf(row)
        })

      const sendAsForTeam = (teamId: TeamId, senderId: SenderId | null) =>
        Effect.gen(function* () {
          const [row, verified] = yield* Effect.all([chosenRow(teamId, senderId), verifiedOf(teamId)])
          return row && verified.has(domainOf(row.address)) ? sendAsOf(row) : undefined
        })

      const footerSender = (teamId: TeamId, senderId: SenderId | null) =>
        Effect.map(chosenRow(teamId, senderId), (row) =>
          row ? { legalName: row.legalName, postalAddress: row.postalAddress } : undefined,
        )

      /**
       * A domain belongs to one team. A verified claim stands; an unverified one lapses after
       * CLAIM_DAYS, so nobody can hold a domain they can't prove is theirs (another team may then
       * take it over). The provider's record is shared, so a takeover reuses it.
       */
      const addDomain = <P, T>(access: CanManageEmail<P, T>, input: string) =>
        Effect.gen(function* () {
          const domain = normalizeDomain(input)
          const teamId = access.member.team.value
          const taken = () => new SendingDomainTaken({ domain: EchoedInput.fromRequest(domain) })
          const [count] = yield* run(
            db.query((d) =>
              d
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.sendingDomains)
                .where(eq(schema.sendingDomains.teamId, teamId)),
            ),
          )
          if (Number(count?.count ?? 0) >= DOMAIN_LIMIT) {
            return yield* new SendingDomainLimitReached({ team: access.member.teamName, limit: DOMAIN_LIMIT })
          }
          const [existing] = yield* run(
            db.query((d) => d.select().from(schema.sendingDomains).where(eq(schema.sendingDomains.domain, domain))),
          )
          if (existing) {
            const lapsed =
              existing.status !== "verified" && Date.now() - existing.createdAt.getTime() > CLAIM_DAYS * 86_400_000
            if (existing.teamId === teamId || !lapsed) return yield* taken()
            const checked = existing.providerId
              ? yield* mailer.domains.verify(existing.providerId)
              : yield* mailer.domains.create(domain)
            const [moved] = yield* run(
              db.query((d) =>
                d
                  .update(schema.sendingDomains)
                  .set({
                    teamId,
                    providerId: checked.providerId,
                    status: checked.status,
                    records: [...checked.records],
                    createdAt: sql`now()`,
                    updatedAt: sql`now()`,
                  })
                  // Only if it's still the lapsed claim we looked at.
                  .where(
                    and(eq(schema.sendingDomains.id, existing.id), eq(schema.sendingDomains.teamId, existing.teamId)),
                  )
                  .returning(),
              ),
            )
            return moved ? toDomain(moved) : yield* taken()
          }
          const registered = yield* mailer.domains.create(domain)
          const id = crypto.randomUUID()
          // Two teams adding the same domain at once: the unique index decides.
          yield* db
            .query((d) =>
              d.insert(schema.sendingDomains).values({
                id,
                teamId,
                domain,
                providerId: registered.providerId,
                status: registered.status,
                records: [...registered.records],
              }),
            )
            .pipe(
              Effect.catchTag(
                "SqlError",
                (error: SqlError.SqlError): Effect.Effect<never, SendingDomainTaken | DatabaseUnavailable> =>
                  isUniqueViolation(error, "sending_domains_domain_key")
                    ? Effect.fail(taken())
                    : classifySqlError(error),
              ),
            )
          const [row] = yield* run(
            db.query((d) => d.select().from(schema.sendingDomains).where(eq(schema.sendingDomains.id, id))),
          )
          return toDomain(row as typeof schema.sendingDomains.$inferSelect)
        }).pipe(Effect.withSpan("Sending.addDomain"))

      const providerIdOf = (id: string) =>
        run(
          db.query((d) =>
            d
              .select({ providerId: schema.sendingDomains.providerId })
              .from(schema.sendingDomains)
              .where(eq(schema.sendingDomains.id, id)),
          ),
        ).pipe(Effect.map(([row]) => row?.providerId ?? null))

      const verifyDomain = <T, D>(target: SendingDomainInTeam<D, T>) =>
        Effect.gen(function* () {
          const providerId = yield* providerIdOf(target.domain.value)
          const checked = providerId
            ? yield* mailer.domains.verify(providerId)
            : yield* mailer.domains.create(target.found.domain)
          const [row] = yield* run(
            db.query((d) =>
              d
                .update(schema.sendingDomains)
                .set({
                  providerId: checked.providerId,
                  status: checked.status,
                  records: [...checked.records],
                  updatedAt: sql`now()`,
                })
                .where(
                  and(
                    eq(schema.sendingDomains.teamId, target.team.value),
                    eq(schema.sendingDomains.id, target.domain.value),
                  ),
                )
                .returning(),
            ),
          )
          return row ? toDomain(row) : target.found
        }).pipe(Effect.withSpan("Sending.verifyDomain"))

      const removeDomain = <T, D>(target: SendingDomainInTeam<D, T>) =>
        Effect.gen(function* () {
          const providerId = yield* providerIdOf(target.domain.value)
          if (providerId) yield* mailer.domains.remove(providerId)
          yield* run(
            db.query((d) =>
              d
                .delete(schema.sendingDomains)
                .where(
                  and(
                    eq(schema.sendingDomains.teamId, target.team.value),
                    eq(schema.sendingDomains.id, target.domain.value),
                  ),
                ),
            ),
          )
          return target.found
        }).pipe(Effect.withSpan("Sending.removeDomain"))

      return {
        senders: (member) => sendersOf(member.team.value),
        locateSender: (teamId, id) => oneSender(teamId, id),
        createSender,
        updateSender: (target, input) => updateSender(target, input),
        setDefaultSender: (target) => setDefaultSender(target),
        deleteSender: (target) => deleteSender(target),
        sendAs,
        sendAsForTeam,
        footerSender,
        domains: (member) => domainsOf(member.team.value),
        locateDomain: (teamId, id) =>
          run(
            db.query((d) =>
              d
                .select()
                .from(schema.sendingDomains)
                .where(and(eq(schema.sendingDomains.teamId, teamId), eq(schema.sendingDomains.id, id))),
            ),
          ).pipe(Effect.map(([row]) => (row ? toDomain(row) : undefined))),
        addDomain,
        verifyDomain,
        removeDomain,
      }
    }),
  )
}
