import {
  type Campaign,
  type CampaignId,
  CampaignNotDraft,
  CampaignNotFound,
  type DatabaseUnavailable,
  type TeamId,
} from "@parley/domain"
import { DisplayName } from "@parley/errors"
import { Effect } from "effect"
import { Campaigns } from "../services/campaigns.ts"
import type { MemberOf } from "./member-of.ts"
import { defineProof, type Named, type Proof } from "./proof.ts"

const CampaignInTeamProver = defineProof("CampaignInTeam")
const CampaignIsDraftProver = defineProof("CampaignIsDraft")

/** Campaign C belongs to team T. */
export interface CampaignInTeam<C, T> extends Proof<"CampaignInTeam", [C, T]> {
  readonly team: Named<T, TeamId>
  readonly campaign: Named<C, CampaignId>
  readonly found: Campaign
}

/** Campaign C hasn't been sent, so it can still change (R42). */
export interface CampaignIsDraft<C> extends Proof<"CampaignIsDraft", [C]> {}

export const proveCampaignInTeam = <P, T, C>(
  member: MemberOf<P, T>,
  campaign: Named<C, CampaignId>,
): Effect.Effect<CampaignInTeam<C, T>, CampaignNotFound | DatabaseUnavailable, Campaigns> =>
  Effect.gen(function* () {
    const campaigns = yield* Campaigns
    const found = yield* campaigns.locate(member.team.value, campaign.value)
    if (!found) return yield* new CampaignNotFound({ team: member.teamName, campaignId: campaign.value })
    return { ...CampaignInTeamProver.prove(campaign, member.team), team: member.team, campaign, found }
  })

export const proveCampaignIsDraft = <C, T>(
  target: CampaignInTeam<C, T>,
): Effect.Effect<CampaignIsDraft<C>, CampaignNotDraft> =>
  target.found.status === "draft"
    ? Effect.succeed(CampaignIsDraftProver.prove(target.campaign))
    : Effect.fail(
        new CampaignNotDraft({ campaign: DisplayName.fromRecord(target.found.name), status: target.found.status }),
      )
