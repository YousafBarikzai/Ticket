import { describe, expect, it } from 'vitest';
import { shiftPatternSchema } from '../service/availability-service.js';

describe('the shift pattern schema', () => {
  it('accepts a pattern naming only the days a team works', () => {
    // A five-day team must not have to write `sat: []` and `sun: []`.
    expect(shiftPatternSchema.safeParse({ mon: [{ from: '09:00', to: '17:00' }] }).success).toBe(true);
  });

  it('refuses a day that is not a day', () => {
    expect(shiftPatternSchema.safeParse({ funday: [{ from: '09:00', to: '17:00' }] }).success).toBe(false);
  });

  it('refuses a time it cannot read', () => {
    expect(shiftPatternSchema.safeParse({ mon: [{ from: '9am', to: '17:00' }] }).success).toBe(false);
    expect(shiftPatternSchema.safeParse({ mon: [{ from: '25:00', to: '26:00' }] }).success).toBe(false);
  });
});
