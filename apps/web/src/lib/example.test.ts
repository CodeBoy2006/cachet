import { describe, expect, it } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import { canonicalize, verifyBinding } from '@cachet/core';
import { LocalBchSigner } from '@cachet/signers';
import { makeExample } from './example.ts';
import { SCENARIOS } from './scenarios.ts';

describe('makeExample and Lab scenarios', () => {
  it('builds a valid dual-key example and a rejected address-spoofing attempt', async () => {
    const ex = await makeExample();
    expect(ex.result.ok).toBe(true);
    expect(ex.result.code).toBe('ok');

    expect(ex.forged.result.ok).toBe(false);
    expect(ex.forged.result.code).toBe('signature_invalid');
    const eventCheck = ex.forged.result.checks.find((c) => c.id === 'event');
    const bchCheck = ex.forged.result.checks.find((c) => c.id === 'bch_signature');
    expect(eventCheck?.status).toBe('pass');
    expect(bchCheck?.status).toBe('fail');
  });

  it('verifies all 12 adversarial Lab scenarios against their expected invariant codes', async () => {
    expect(SCENARIOS).toHaveLength(12);
    for (const s of SCENARIOS) {
      const built = await s.build();
      const raw = JSON.stringify(built.event, null, 2);
      const res = verifyBinding(raw, { now: built.now });
      if (s.expect === 'ok') {
        expect(res.ok).toBe(true);
      } else {
        expect(res.ok).toBe(false);
        expect(res.code).toBe(s.expect);
      }
    }
  });

  it('triggers distinct named failures for Lab one-click tamper presets', async () => {
    const valid = await SCENARIOS[0]!.build();
    expect(valid.secret).toBeDefined();
    expect(valid.proof).toBeDefined();

    // 1. Swap address + re-sign outer Nostr event -> passes Nostr check, fails BCH signature check
    const swappedAddr = LocalBchSigner.generate().address();
    const forgedProof = { ...valid.proof!, statement: { ...valid.proof!.statement, cashaddr: swappedAddr } };
    const swappedEvent = finalizeEvent(
      { kind: 10011, created_at: valid.now - 25, tags: [['i', `bch:${swappedAddr}`, canonicalize(forgedProof)]], content: '' },
      valid.secret!,
    );
    const swappedRes = verifyBinding(JSON.stringify(swappedEvent), { now: valid.now });
    expect(swappedRes.code).toBe('signature_invalid');

    // 2. Flip 1 hex nibble of Nostr signature -> fails outer Nostr signature check
    const rawValid = JSON.stringify(valid.event, null, 2);
    const flipped = rawValid.replace(/"sig":\s*"([0-9a-f])/, (_, c: string) => `"sig": "${c === '0' ? '1' : '0'}`);
    const flippedRes = verifyBinding(flipped, { now: valid.now });
    expect(flippedRes.code).toBe('event_signature_invalid');

    // 3. Pretty-print inner proof + re-sign outer Nostr event -> fails JCS canonicalization check
    const nonCanonicalEvent = finalizeEvent(
      {
        kind: 10011,
        created_at: valid.now - 25,
        tags: [['i', `bch:${valid.proof!.statement.cashaddr}`, JSON.stringify(valid.proof!, null, 2)]],
        content: '',
      },
      valid.secret!,
    );
    const nonCanonicalRes = verifyBinding(JSON.stringify(nonCanonicalEvent), { now: valid.now });
    expect(nonCanonicalRes.code).toBe('proof_not_canonical');
  });
});
