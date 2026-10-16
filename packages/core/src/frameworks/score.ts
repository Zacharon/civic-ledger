export type Position = 'yea' | 'nay' | 'present' | 'not_voting';

/** The rule that claims a rollcall. Each rollcall counts for at most one rule. */
export interface RollcallClaim {
  ruleIndex: number;
  alignedPosition: 'yea' | 'nay';
  weight: number;
}

export interface CastVote {
  personId: number;
  rollcallId: number;
  position: Position;
}

export interface PersonScore {
  aligned: number;
  considered: number;
  notCounted: number;
  weightedAligned: number;
  weightedConsidered: number;
  votes: { ruleIndex: number; rollcallId: number; position: Position; aligned: boolean | null }[];
}

/**
 * "Aligned X of Y": Y counts the claimed rollcalls where the person voted yea or nay;
 * present / not voting are listed but excluded from both numerator and denominator.
 */
export function scoreVotes(
  claims: Map<number, RollcallClaim>,
  votes: CastVote[],
): Map<number, PersonScore> {
  const scores = new Map<number, PersonScore>();
  for (const vote of votes) {
    const claim = claims.get(vote.rollcallId);
    if (!claim) continue;
    const score = scores.get(vote.personId) ?? {
      aligned: 0,
      considered: 0,
      notCounted: 0,
      weightedAligned: 0,
      weightedConsidered: 0,
      votes: [],
    };
    const counted = vote.position === 'yea' || vote.position === 'nay';
    const aligned = counted ? vote.position === claim.alignedPosition : null;
    if (counted) {
      score.considered += 1;
      score.weightedConsidered += claim.weight;
      if (aligned) {
        score.aligned += 1;
        score.weightedAligned += claim.weight;
      }
    } else {
      score.notCounted += 1;
    }
    score.votes.push({
      ruleIndex: claim.ruleIndex,
      rollcallId: vote.rollcallId,
      position: vote.position,
      aligned,
    });
    scores.set(vote.personId, score);
  }
  for (const score of scores.values())
    score.votes.sort((a, b) => a.ruleIndex - b.ruleIndex || a.rollcallId - b.rollcallId);
  return scores;
}
