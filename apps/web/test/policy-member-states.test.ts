import { FrameworksEvaluateOutput, MEMBER_VOTE_STATES } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { STATE_GLYPH, STATE_LABEL, STATE_LEGEND } from '../app/policy/[area]/member-states';
import { POSITION_LABEL } from '../src/lib/labels';

/**
 * T-C regression 6 (web half): the policy matrix cell text, its visible legend and its
 * screen-reader labels are keyed by exactly the `rollcallStates[].state` values that
 * /api/v1 and MCP return (same output schema), so they cannot disagree.
 */
describe('policy matrix member states', () => {
  const apiStates =
    FrameworksEvaluateOutput.shape.results.element.shape.rollcallStates.element.shape.state.options;

  it('covers every API state, in API order, with nothing extra', () => {
    expect(apiStates).toEqual([...MEMBER_VOTE_STATES]);
    expect([...STATE_LEGEND]).toEqual(apiStates);
    expect(Object.keys(STATE_LABEL).sort()).toEqual([...apiStates].sort());
    expect(Object.keys(STATE_GLYPH).sort()).toEqual([...apiStates].sort());
  });

  it('gives each state a distinct label and glyph', () => {
    expect(new Set(Object.values(STATE_LABEL)).size).toBe(apiStates.length);
    expect(new Set(Object.values(STATE_GLYPH)).size).toBe(apiStates.length);
  });

  it('labels recorded positions as everywhere else and never reads absence as non-membership', () => {
    for (const position of ['yea', 'nay', 'present', 'not_voting'] as const)
      expect(STATE_LABEL[position]).toBe(POSITION_LABEL[position]);
    expect(STATE_LABEL.unavailable).not.toMatch(/not (a member|serving)/i);
    expect(STATE_LABEL.not_serving).toMatch(/not serving/i);
  });
});
