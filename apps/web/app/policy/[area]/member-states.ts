import { MEMBER_VOTE_STATES, type MemberVoteState } from '@civic-ledger/core';

/**
 * Matrix cell text for each `frameworks.evaluate` `rollcallStates[].state` value. The
 * glyph is visual only; the label is what screen readers and the visible legend say, so
 * the cell, the legend and the API value always name the same state.
 */
export const STATE_GLYPH: Record<MemberVoteState, string> = {
  yea: 'Y',
  nay: 'N',
  present: 'P',
  not_voting: '–',
  not_serving: '·',
  unavailable: '?',
};

export const STATE_LABEL: Record<MemberVoteState, string> = {
  yea: 'Yea',
  nay: 'Nay',
  present: 'Present',
  not_voting: 'Not voting',
  not_serving: 'Not serving in this chamber on the vote date',
  unavailable: 'Serving, but no vote record stored',
};

/** Legend order = the API enum order. */
export const STATE_LEGEND: readonly MemberVoteState[] = MEMBER_VOTE_STATES;
