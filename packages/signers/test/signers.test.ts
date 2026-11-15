import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { encodePrivateKeyWif, secp256k1 } from '@bitauth/libauth';
import { addressFromPublicKey, bindMessage, createStatement, recoverSigner } from '@cachet/core';
import { LocalBchSigner, LocalNostrSigner, Nip07Signer, acceptSignedEvent, assertSignedBy } from '../src/index.ts';

describe('signer output is checked, not trusted', () => {
  const template = { kind: 10011, created_at: 1_700_000_000, tags: [['i', 'github:x', 'y']], content: '' };

  it('accepts a correct event from the expected key', async () => {
    const s = LocalNostrSigner.generate();
    const e = await s.signEvent(template);
    expect(e.pubkey).toBe(s.pubkey);
  });

  it('rejects events from another key, or changed before signing', async () => {
    const s = LocalNostrSigner.generate();
    const other = generateSecretKey();
    expect(() => acceptSignedEvent(finalizeEvent(template, other), template, s.pubkey)).toThrow(/different Nostr key/);
    const changed = finalizeEvent({ ...template, tags: [] }, other);
    expect(() => acceptSignedEvent(changed, template, changed.pubkey)).toThrow(/changed the event/);

    const sk = generateSecretKey();
    const pk = LocalNostrSigner.fromNsec(new LocalNostrSigner(sk).nsec).pubkey;
    (globalThis as { nostr?: unknown }).nostr = {
      getPublicKey: async () => pk,
      signEvent: async (mutated: typeof template) => {
        mutated.content = 'tampered';
        mutated.tags[0]![1] = 'github:attacker';
        return finalizeEvent(mutated, sk);
      },
    };
    try {
      await expect(new Nip07Signer().signEvent({ ...template, tags: [['i', 'github:x', 'y']] })).rejects.toThrow(/changed the event/);
    } finally {
      delete (globalThis as { nostr?: unknown }).nostr;
    }
  });

  it('rejects a BCH signature from an address other than the selected one', async () => {
    const wallet = LocalBchSigner.generate();
    const other = LocalBchSigner.generate();
    const st = createStatement({ cashaddr: wallet.address(), nostrPubkey: LocalNostrSigner.generate().pubkey });
    const message = bindMessage(st);
    const sig = await wallet.signMessage(message, wallet.address());
    expect(assertSignedBy(message, sig, wallet.address(true))).toBe(sig); // same key, token-aware form
    await expect(other.signMessage(message, wallet.address())).rejects.toThrow(/different address/);
  });

  it('round-trips sandbox keys through WIF and nsec', () => {
    const b = LocalBchSigner.generate();
    expect(LocalBchSigner.fromWif(b.wif).address()).toBe(b.address());
    const n = LocalNostrSigner.generate();
    expect(LocalNostrSigner.fromNsec(n.nsec).pubkey).toBe(n.pubkey);
  });

  it('preserves mainnet uncompressed WIF, address and message signatures', async () => {
    const key = generateSecretKey();
    const wif = encodePrivateKeyWif(key, 'mainnetUncompressed');
    const signer = LocalBchSigner.fromWif(wif);
    const address = addressFromPublicKey(secp256k1.derivePublicKeyUncompressed(key) as Uint8Array, 'mainnet');
    expect(signer.network).toBe('mainnet');
    expect(signer.compressed).toBe(false);
    expect(signer.wif).toBe(wif);
    expect(signer.address()).toBe(address);
    const signature = await signer.signMessage('uncompressed key', address);
    expect(assertSignedBy('uncompressed key', signature, address)).toBe(signature);
    expect(recoverSigner('uncompressed key', signer.signRaw('uncompressed key'))).toMatchObject({ ok: true, compressed: false });
  });
});
