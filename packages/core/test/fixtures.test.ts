import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyBinding } from '../src/index.ts';

// Shared vectors in fixtures/ (regenerate with `npx tsx scripts/make-fixtures.ts`).
const index = JSON.parse(readFileSync(new URL('../../../fixtures/index.json', import.meta.url), 'utf8')) as {
  now: number;
  cases: { name: string; expect: string }[];
};

describe('fixtures', () => {
  for (const c of index.cases) {
    it(`${c.name} → ${c.expect}`, () => {
      const raw = readFileSync(new URL(`../../../fixtures/${c.name}`, import.meta.url), 'utf8');
      expect(verifyBinding(raw, { now: index.now }).code).toBe(c.expect);
    });
  }
});
