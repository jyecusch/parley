import type {
  createSender,
  createSendingDomain,
  createTopic,
  deleteSender,
  deleteSendingDomain,
  deleteTopic,
  getContactSubscriptions,
  listSenders,
  listSendingDomains,
  listTopics,
  OperationInput,
  setDefaultSender,
  updateContactSubscriptions,
  updateSender,
  updateTopic,
  verifySendingDomain,
} from "@parley/domain"
import { Effect } from "effect"
import type { Principal } from "../principal.ts"
import { proveContactInTeam } from "../proofs/contact-in-team.ts"
import { proveMemberOf } from "../proofs/member-of.ts"
import {
  proveCanManageEmail,
  proveCanReadRecords,
  proveCanWriteEmail,
  proveCanWriteRecords,
} from "../proofs/permissions.ts"
import { named } from "../proofs/proof.ts"
import { proveSenderInTeam } from "../proofs/sender-in-team.ts"
import { proveSendingDomainInTeam } from "../proofs/sending-domain-in-team.ts"
import { proveTopicInTeam, proveTopicsInTeam } from "../proofs/topic-in-team.ts"
import { Sending } from "../services/sending.ts"
import { Subscriptions } from "../services/subscriptions.ts"
import { Topics } from "../services/topics.ts"

export const listAllSenders = (principal: Principal, input: OperationInput<typeof listSenders>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      return yield* sending.senders(member)
    }),
  )

export const addSender = (principal: Principal, input: OperationInput<typeof createSender>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      return yield* sending.createSender(access, input)
    }),
  )

export const changeSender = (principal: Principal, input: OperationInput<typeof updateSender>) =>
  named(principal, input.teamId, input.senderId, (principal, team, sender) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveSenderInTeam(member, sender)
      return yield* sending.updateSender(target, input, access)
    }),
  )

export const makeDefaultSender = (principal: Principal, input: OperationInput<typeof setDefaultSender>) =>
  named(principal, input.teamId, input.senderId, (principal, team, sender) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveSenderInTeam(member, sender)
      return yield* sending.setDefaultSender(target, access)
    }),
  )

export const removeSender = (principal: Principal, input: OperationInput<typeof deleteSender>) =>
  named(principal, input.teamId, input.senderId, (principal, team, sender) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveSenderInTeam(member, sender)
      return yield* sending.deleteSender(target, access)
    }),
  )

export const listDomains = (principal: Principal, input: OperationInput<typeof listSendingDomains>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanWriteEmail(member)
      return yield* sending.domains(member)
    }),
  )

export const createDomain = (principal: Principal, input: OperationInput<typeof createSendingDomain>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      return yield* sending.addDomain(access, input.domain)
    }),
  )

export const verifyDomain = (principal: Principal, input: OperationInput<typeof verifySendingDomain>) =>
  named(principal, input.teamId, input.sendingDomainId, (principal, team, domain) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveSendingDomainInTeam(member, domain)
      return yield* sending.verifyDomain(target, access)
    }),
  )

export const deleteDomain = (principal: Principal, input: OperationInput<typeof deleteSendingDomain>) =>
  named(principal, input.teamId, input.sendingDomainId, (principal, team, domain) =>
    Effect.gen(function* () {
      const sending = yield* Sending
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveSendingDomainInTeam(member, domain)
      return yield* sending.removeDomain(target, access)
    }),
  )

export const listAllTopics = (principal: Principal, input: OperationInput<typeof listTopics>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const topics = yield* Topics
      const member = yield* proveMemberOf(principal, team)
      yield* proveCanReadRecords(member)
      return yield* topics.list(member)
    }),
  )

export const addTopic = (principal: Principal, input: OperationInput<typeof createTopic>) =>
  named(principal, input.teamId, (principal, team) =>
    Effect.gen(function* () {
      const topics = yield* Topics
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      return yield* topics.create(access, input)
    }),
  )

export const changeTopic = (principal: Principal, input: OperationInput<typeof updateTopic>) =>
  named(principal, input.teamId, input.topicId, (principal, team, topic) =>
    Effect.gen(function* () {
      const topics = yield* Topics
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveTopicInTeam(member, topic)
      return yield* topics.update(target, input, access)
    }),
  )

export const removeTopic = (principal: Principal, input: OperationInput<typeof deleteTopic>) =>
  named(principal, input.teamId, input.topicId, (principal, team, topic) =>
    Effect.gen(function* () {
      const topics = yield* Topics
      const member = yield* proveMemberOf(principal, team)
      const access = yield* proveCanManageEmail(member)
      const target = yield* proveTopicInTeam(member, topic)
      return yield* topics.delete(target, access)
    }),
  )

export const contactSubscriptions = (principal: Principal, input: OperationInput<typeof getContactSubscriptions>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      return yield* subscriptions.ofContact(target, canRead)
    }),
  )

export const updateSubscriptions = (principal: Principal, input: OperationInput<typeof updateContactSubscriptions>) =>
  named(principal, input.teamId, input.contactId, (principal, team, contact) =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions
      const member = yield* proveMemberOf(principal, team)
      const canRead = yield* proveCanReadRecords(member)
      const canWrite = yield* proveCanWriteRecords(member)
      const target = yield* proveContactInTeam(team, contact, canRead)
      const topics = yield* proveTopicsInTeam(
        member,
        input.topics.map((change) => change.topicId),
      )
      const wanted = new Map(input.topics.map((change) => [change.topicId, change.subscribed]))
      // Rejoining a topic someone left takes email:manage, like resubscribing them to everything.
      const current = yield* subscriptions.ofContact(target, canRead)
      const rejoining = current.topics.some((topic) => !topic.subscribed && wanted.get(topic.topicId) === true)
      const resubscribe = rejoining ? yield* proveCanManageEmail(member) : undefined
      return yield* subscriptions.updateTopics(target, topics, wanted, canWrite, resubscribe)
    }),
  )
