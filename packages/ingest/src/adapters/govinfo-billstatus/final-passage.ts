/**
 * Whether a rollcall question is the vote that passes or adopts the measure itself (as
 * opposed to cloture, amendments, motions to recommit, rules, procedure). Patterns follow
 * Voteview `vote_question` wording for both chambers (119th Congress):
 * House "On Passage", "On Motion to Suspend the Rules and Pass[, as Amended]",
 * "On Agreeing to the Resolution", "On Motion to Concur in the Senate Amendment(s)",
 * veto overrides; Senate "On Passage of the Bill", "On the Joint/Concurrent Resolution",
 * "On the Resolution", "On the Conference Report", "On Overriding the Veto".
 */
const FINAL_PASSAGE = [
  /^On Passage\b/i,
  /^On Motion to Suspend the Rules and (Pass|Agree|Concur)\b/i,
  /^On Agreeing to the (Resolution|Conference Report)\b/i,
  /^On Motion to Concur in the Senate Amendments?\b/i,
  /^Passage, Objections of the President/i,
  /^On the (Joint |Concurrent )?Resolution\b/i,
  /^On the Conference Report\b/i,
  /^On Overriding the Veto\b/i,
];

export const isFinalPassageQuestion = (question: string): boolean =>
  FINAL_PASSAGE.some((pattern) => pattern.test(question.trim()));
