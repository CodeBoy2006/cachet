import { describe, expect, it } from 'vitest';
import { bchPoint, curvePaths, nostrPoint } from './curve.ts';
import { makeExample } from './example.ts';

describe('curve emblem', () => {
  it('places keys on y² = x³ + 7 by their x-coordinate and y parity', () => {
    const x = 'a'.repeat(64);
    const p = nostrPoint(x)!;
    const even = bchPoint(`02${x}`)!;
    const odd = bchPoint(`03${x}`)!;
    expect(p).toEqual(even);
    expect(p.Y).toBeLessThan(0);
    expect(odd.X).toBe(even.X);
    expect(odd.Y).toBe(-even.Y);
    expect(nostrPoint('npub1nothex')).toBeUndefined();
    expect(bchPoint(`04${x}`)).toBeUndefined();
    const { up, down } = curvePaths();
    expect(up.startsWith('M')).toBe(true);
    expect(`${up}${down}`).not.toContain('NaN');
  });

  it('names the key and address the forged signature really recovers', async () => {
    const ex = await makeExample();
    expect(ex.forged.signer).not.toBe(ex.forged.cashaddr);
    expect(ex.forged.signerKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(ex.forged.signerKey).not.toBe(ex.result.binding?.bchPublicKey);
    expect(ex.forged.message).toContain(ex.forged.cashaddr);
  });
});
