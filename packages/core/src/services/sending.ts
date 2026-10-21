import { Database, schema } from "@parley/db"
import {
  type DatabaseUnavailable,
  type DnsRecord,
  type EmailError,
  type EmailSettings,
  normalizeDomain,
  SenderAddressNotOnSendingDomain,
  SenderNotReady,
  type SendingDomain,
  type SendingDomainId,
  SendingDomainLimitReached,
  SendingDomainTaken,
  type TeamId,
} from "@parley/domain"
import { EchoedInput } from "@parley/errors"
import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql"
import { Mailer } from "../mail/mailer.ts"
import type { CanManageEmail, MemberOf } from "../proofs/permissions.ts"
import type { SendingDomainInTeam } from "../proofs/sending-domain-in-team.ts"
import { classifySqlError, isUniqueViolation } from "./sql-errors.ts"

export interface EmailSettingsInput {
  readonly senderName?: string | null | undefined
  readonly senderAddress?: string | null | undefined
  readonly replyTo?: string | null | undefined
  readonly legalName?: string | null | undefined
  readonly postalAddress?: string | null | undefined
  readonly footerReason?: string | null | undefined
}

/** Who a team's broadcast email is from, and its footer, as sent (R40). Copied onto a broadcast when it starts. */
export interface Sender {
  readonly from: string
  readonly replyTo: string | null
  readonly legalName: string
  readonly postalAddress: string
  readonly footerReason: string
}

/** How many sending domains a team may have; each is registered with the email provider. */
const DOMAIN_LIMIT = 5
/** How long an unverified domain stays claimed before another team may take it. */
const CLAIM_DAYS = 3

const domainOf = (address: string | null) => (address ? (address.split("@")[1]?.toLowerCase() ?? "") : "")

/** A display name in a From header, quoted when it needs to be. */
const fromHeader = (name: string, address: string) =>
  /^[\w .'-]+$/.test(name) ? `${name} <${address}>` : `"${name.replace(/["\\\r\n]/g, "")}" <${address}>`

/** A team's sender, footer and sending domains (R40, R44). Process tier: the team is passed per call. */
export class Sending extends Context.Service<
  Sending,
  {
    readonly settings: <P, T>(member: MemberOf<P, T>) => Effect.Effect<EmailSettings, DatabaseUnavailable>
    readonly updateSettings: <P, T>(
      access: CanManageEmail<P, T>,
      input: EmailSettingsInput,
    ) => Effect.Effect<EmailSettings, SenderAddressNotOnSendingDomain | DatabaseUnavailable>
    /** The sender for a send, or what's missing. */
    readonly sender: <P, T>(member: MemberOf<P, T>) => Effect.Effect<Sender, SenderNotReady | DatabaseUnavailable>
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

      const rowOf = (teamId: TeamId) =>
        run(db.query((d) => d.select().from(schema.emailSettings).where(eq(schema.emailSettings.teamId, teamId)))).pipe(
          Effect.map(([row]) => row),
        )

      const settingsOf = (teamId: TeamId) =>
        Effect.gen(function* () {
          const [row, domains] = yield* Effect.all([rowOf(teamId), domainsOf(teamId)])
          const verified = new Set(
            domains.filter((domain) => domain.status === "verified").map((domain) => domain.domain),
          )
          const senderAddress = row?.senderAddress ?? null
          const missing: Array<EmailSettings["missing"][number]> = []
          if (!row?.senderName) missing.push("sender-name")
          if (!senderAddress) missing.push("sender-address")
          else if (!verified.has(domainOf(senderAddress))) missing.push("verified-domain")
          if (!row?.legalName) missing.push("legal-name")
          if (!row?.postalAddress) missing.push("postal-address")
          if (!row?.footerReason) missing.push("footer-reason")
          const settings: EmailSettings = {
            senderName: row?.senderName ?? null,
            senderAddress,
            replyTo: row?.replyTo ?? null,
            legalName: row?.legalName ?? null,
            postalAddress: row?.postalAddress ?? null,
            footerReason: row?.footerReason ?? null,
            missing,
          }
          return settings
        })

      const updateSettings = <P, T>(access: CanManageEmail<P, T>, input: EmailSettingsInput) =>
        Effect.gen(function* () {
          const teamId = access.member.team.value
          if (input.senderAddress) {
            const domains = yield* domainsOf(teamId)
            const domain = domainOf(input.senderAddress)
            if (!domains.some((entry) => entry.domain === domain)) {
              return yield* new SenderAddressNotOnSendingDomain({
                address: EchoedInput.fromRequest(input.senderAddress),
              })
            }
          }
          const values = {
            ...(input.senderName !== undefined ? { senderName: input.senderName } : {}),
            ...(input.senderAddress !== undefined ? { senderAddress: input.senderAddress?.toLowerCase() ?? null } : {}),
            ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
            ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
            ...(input.postalAddress !== undefined ? { postalAddress: input.postalAddress } : {}),
            ...(input.footerReason !== undefined ? { footerReason: input.footerReason } : {}),
          }
          yield* run(
            db.query((d) =>
              d
                .insert(schema.emailSettings)
                .values({ teamId, ...values })
                .onConflictDoUpdate({ target: schema.emailSettings.teamId, set: { ...values, updatedAt: sql`now()` } }),
            ),
          )
          return yield* settingsOf(teamId)
        }).pipe(Effect.withSpan("Sending.updateSettings"))

      const sender = <P, T>(member: MemberOf<P, T>) =>
        Effect.gen(function* () {
          const settings = yield* settingsOf(member.team.value)
          if (
            settings.missing.length > 0 ||
            !settings.senderName ||
            !settings.senderAddress ||
            !settings.legalName ||
            !settings.postalAddress ||
            !settings.footerReason
          ) {
            return yield* new SenderNotReady({ team: member.teamName, missing: settings.missing })
          }
          const ready: Sender = {
            from: fromHeader(settings.senderName, settings.senderAddress),
            replyTo: settings.replyTo,
            legalName: settings.legalName,
            postalAddress: settings.postalAddress,
            footerReason: settings.footerReason,
          }
          return ready
        })

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
        settings: (member) => settingsOf(member.team.value),
        updateSettings,
        sender,
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
