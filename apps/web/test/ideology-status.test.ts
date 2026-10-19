import { describe, expect, it } from 'vitest';
import { ideologyStatusLabel } from '../src/components/profile/ideology-status';

describe('ideology status label (profile Scores)', () => {
  it('labels provisional and unknown estimates and leaves final ones unlabeled', () => {
    expect(ideologyStatusLabel(true)).toBe('Provisional estimate');
    expect(ideologyStatusLabel(null)).toBe('Status unknown');
    expect(ideologyStatusLabel(false)).toBeNull();
  });
});
