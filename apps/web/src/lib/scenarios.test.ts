import { describe, expect, it } from 'vitest';
import { verifyBinding } from '@cachet/core';
import { SCENARIOS } from './scenarios.ts';

describe('lab scenarios', () => {
  it('has one honest case and eleven attacks, as the home page and slides say', () => {
    expect(SCENARIOS.filter((s) => s.expect === 'ok')).toHaveLength(1);
    expect(SCENARIOS.filter((s) => s.expect !== 'ok')).toHaveLength(11);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s fails exactly the check it names', async (_, scenario) => {
    const built = await scenario.build();
    // The Lab verifies the pretty-printed editor text, so do the same here.
    const result = verifyBinding(JSON.stringify(built.event, null, 2), { now: built.now });
    if (scenario.expect === 'ok') expect(result.ok).toBe(true);
    else expect(result.code).toBe(scenario.expect);
  });
});
