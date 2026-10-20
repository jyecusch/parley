import type { FieldValue, TeamId, UserId } from "@parley/domain"
import { useQuery } from "@tanstack/react-query"
import { call } from "./client.ts"

/** Someone who can be a record owner (D123): a member of the team, or one of its service accounts. */
export interface Person {
  readonly userId: UserId
  readonly name: string
  readonly kind: "member" | "service-account"
  /** A member's email address; service accounts have none worth matching on. */
  readonly email: string | null
}

/** How a person reads in a picker: service accounts are marked, so they aren't mistaken for people. */
export const personLabel = (person: Person) =>
  person.kind === "service-account" ? `${person.name} (service account)` : person.name

/**
 * The team's members and service accounts, people first, each sorted by name. Every member can read
 * both lists; if service accounts don't load, the members still do.
 */
export const usePeople = (teamId: TeamId) =>
  useQuery({
    queryKey: ["people", teamId],
    queryFn: async (): Promise<ReadonlyArray<Person>> => {
      const [members, accounts] = await Promise.all([
        call("members.list", { teamId }),
        call("serviceAccounts.list", { teamId }).catch(() => []),
      ])
      const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)
      const people: Array<Person> = members
        .map((member): Person => ({ userId: member.userId, name: member.name, kind: "member", email: member.email }))
        .sort(byName)
      const seen = new Set(people.map((person) => person.userId))
      const bots = accounts
        .filter((account) => !seen.has(account.id))
        .map((account): Person => ({ userId: account.id, name: account.name, kind: "service-account", email: null }))
        .sort(byName)
      return [...people, ...bots]
    },
    staleTime: 60_000,
  })

/** People as filter choices for a record owner condition: "Me (name)" first, then everyone else. */
export const usePeopleOptions = (teamId: TeamId, me: string) => {
  const people = usePeople(teamId).data ?? []
  const self = people.find((person) => person.userId === me)
  return [
    ...(self ? [{ id: self.userId as string, label: `Me (${self.name})` }] : []),
    ...people
      .filter((person) => person.userId !== me)
      .map((person) => ({ id: person.userId as string, label: personLabel(person) })),
  ]
}

/**
 * A field reader for sorting: the record owner sorts by their name, lowercased, the way the server
 * orders it (D123); every other field reads as it does for filters.
 */
export const sortReaderOf =
  <R extends { readonly ownerName: string | null }>(read: (record: R) => (field: string) => FieldValue) =>
  (record: R) =>
  (field: string): FieldValue =>
    field === "owner" ? (record.ownerName?.toLowerCase() ?? null) : read(record)(field)
