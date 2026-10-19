import { type DatabaseUnavailable, type TeamId, type Topic, type TopicId, TopicNotFound } from "@parley/domain"
import { Effect } from "effect"
import { Topics } from "../services/topics.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const TopicInTeamProver = defineProof("TopicInTeam")

/** Topic K belongs to team T. */
export interface TopicInTeam<K, T> extends Proof<"TopicInTeam", [K, T]> {
  readonly team: Named<T, TeamId>
  readonly topic: Named<K, TopicId>
  readonly found: Topic
}

/** Only looked up in a team the principal is a member of. */
export const proveTopicInTeam = <P, T, K>(
  member: MemberOf<P, T>,
  topic: Named<K, TopicId>,
): Effect.Effect<TopicInTeam<K, T>, TopicNotFound | DatabaseUnavailable, Topics> =>
  Effect.gen(function* () {
    const topics = yield* Topics
    const found = yield* topics.locate(member.team.value, topic.value)
    if (!found) return yield* new TopicNotFound({ team: member.teamName, topicId: topic.value })
    return { ...TopicInTeamProver.prove(topic, member.team), team: member.team, topic, found }
  })

const TopicsInTeamProver = defineProof("TopicsInTeam")

/** Every topic in a list belongs to team T, for changes to many at once. */
export interface TopicsInTeam<T> extends Proof<"TopicsInTeam", [T]> {
  readonly team: Named<T, TeamId>
  readonly found: ReadonlyArray<Topic>
}

export const proveTopicsInTeam = <P, T>(
  member: MemberOf<P, T>,
  topicIds: ReadonlyArray<TopicId>,
): Effect.Effect<TopicsInTeam<T>, TopicNotFound | DatabaseUnavailable, Topics> =>
  Effect.gen(function* () {
    const topics = yield* Topics
    const all = yield* topics.list(member)
    const found: Array<Topic> = []
    for (const id of topicIds) {
      const topic = all.find((candidate) => candidate.id === id)
      if (!topic) return yield* new TopicNotFound({ team: member.teamName, topicId: id })
      found.push(topic)
    }
    return { ...TopicsInTeamProver.prove(member.team), team: member.team, found }
  })
