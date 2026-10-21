import { REGISTRATION_NOTICE as coreNotice } from '@civic-ledger/core';
import { describe, expect, it } from 'vitest';
import { REGISTRATION_NOTICE, raceHref, raceTitle } from '../src/lib/races';

describe('race helpers', () => {
  it('shows the same registration notice as the API and MCP outputs', () => {
    expect(REGISTRATION_NOTICE).toBe(coreNotice);
  });

  it('titles seats and builds the documented URLs', () => {
    expect(raceTitle({ chamber: 'senate', state: 'GA', district: null })).toBe('Georgia Senate');
    expect(raceTitle({ chamber: 'house', state: 'GA', district: 10 })).toBe(
      'Georgia 10th district',
    );
    expect(raceTitle({ chamber: 'house', state: 'AK', district: 0 })).toBe(
      'Alaska at-large district',
    );
    expect(raceHref(2026, 'ga-senate')).toBe('/races/2026/ga-senate');
  });
});
