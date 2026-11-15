import { binToBase64, binToHex, decodePrivateKeyWif, hexToBin, secp256k1 } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addressFromPublicKey,
  canonicalize,
  decodeBase64Strict,
  isAddressError,
  lockingBytecodeHex,
  messageFraming,
  messageHash,
  normalizeCashAddrInput,
  parseCashAddr,
  recoverSigner,
  sameController,
  signMessage,
  toggleTokenForm,
  verifyMessage,
} from '../src/index.ts';

describe('RFC 8785 canonical JSON', () => {
  it('matches the RFC 8785 §3.2.2 example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units (RFC 8785 §3.2.3)', () => {
    const obj = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
    // Object.keys would move integer-like keys first, so read positions from the string itself.
    const out = canonicalize(obj);
    const expected = ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'];
    const positions = expected.map((k) => out.indexOf(`${JSON.stringify(k)}:`));
    expect(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]!))).toBe(true);
  });

  it('rejects lone surrogates and non-finite numbers', () => {
    expect(() => canonicalize('\ud800')).toThrow();
    expect(() => canonicalize(Number.NaN)).toThrow();
  });

  it('is idempotent on parse/serialize round-trips', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = canonicalize(value);
        expect(canonicalize(JSON.parse(once))).toBe(once);
      }),
    );
  });
});

describe('Bitcoin Signed Message', () => {
  // Vectors from mainnet-js src/message/signed.test.ts (cross-checked there against Electron Cash).
  it('hashes like Electron Cash', () => {
    expect(binToHex(messageHash('test'))).toBe('9ce428d58e8e4caf619dc6fc7b2c2c28f0561654d1f80f322c038ad5e67ff8a6');
    expect(binToHex(messageHash('测试'))).toBe('8d8405050b7a763ccd5683f8470ea7dcbd10a87da2b7fe07eb2679ba71229688');
    expect(binToBase64(messageHash('Chancellor on brink of second bailout for banks'))).toBe(
      'gE9BDBFAOqW+yoOzABjnM+LQRWHd4dvUVrsTR+sIWsU=',
    );
  });

  const wif = decodePrivateKeyWif('L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN');
  if (typeof wif === 'string') throw new Error(wif);
  const pub = secp256k1.derivePublicKeyCompressed(wif.privateKey) as Uint8Array;
  const address = 'bitcoincash:qqehccy89v7ftlfgr9v0zvhjzyy7eatdkqt05lt3nw';
  const msg = 'Chancellor on brink of second bailout for banks';
  const sig = 'H/9jMOnj4MFbH3d7t4yCQ9i7DgZU/VZ278w3+ySv2F4yIsdqjsc5ng3kmN8OZAThgyfCZOQxZCWza9V5XzlVY0Y=';
  const hash = (parseCashAddr(address) as { payload: Uint8Array }).payload;

  it('reproduces the mainnet-js / Electron Cash signature and address', () => {
    expect(addressFromPublicKey(pub, 'mainnet')).toBe(address);
    expect(signMessage(wif.privateKey, msg)).toBe(sig);
    expect(verifyMessage(msg, sig, hash)).toBe(true);
    expect(verifyMessage('Lessons for China from Japan’s lost decade', sig, hash)).toBe(false);
  });

  it('verifies the Electron Cash testnet vector', () => {
    const tAddr = parseCashAddr('bchtest:qqf25s9nm4uq982t94vq75v78n4j0e4r4vdf9j48wn');
    if (isAddressError(tAddr)) throw new Error(tAddr.detail);
    const tSig = 'INGajEdcctxl+WR/icZJ5mNenqcxfhqhAkBkAauBxfZFdeKaU/FaL7fxgVyTul6Qxz1Oesn8avN/F+AaFIcMP74=';
    expect(verifyMessage('test', tSig, tAddr.payload)).toBe(true);
    expect(verifyMessage('test2', tSig, tAddr.payload)).toBe(false);
  });

  it('rejects malformed signatures with specific codes', () => {
    const bytes = decodeBase64Strict(sig)!;
    const variant = (f: (b: Uint8Array) => Uint8Array) => binToBase64(f(Uint8Array.from(bytes)));
    expect(verifyMessage(`${msg}\n`, sig, hash)).toBe(false);
    expect(recoverSigner(msg, variant((b) => b.slice(0, 64)))).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
    expect(recoverSigner(msg, variant((b) => ((b[0] = 26), b)))).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
    expect(recoverSigner(msg, variant((b) => ((b[0] = 35), b)))).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
    expect(recoverSigner(msg, variant((b) => (b.fill(0, 1, 33), b)))).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
    expect(recoverSigner(msg, 'not base64!')).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
    expect(recoverSigner(msg, sig.replace('=', ''))).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
    expect(recoverSigner(msg, ` ${sig}`)).toMatchObject({ ok: false, code: 'bch_signature_malformed' });
  });

  it('honours the compression flag in the header', () => {
    const bytes = decodeBase64Strict(sig)!;
    const asUncompressed = Uint8Array.from(bytes);
    asUncompressed[0] = bytes[0]! - 4;
    const recovered = recoverSigner(msg, binToBase64(asUncompressed));
    expect(recovered.ok && recovered.compressed).toBe(false);
    expect(verifyMessage(msg, binToBase64(asUncompressed), hash)).toBe(false);
  });

  it('accepts the malleated (high-S) twin as the same signer', () => {
    const bytes = decodeBase64Strict(sig)!;
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${binToHex(bytes.slice(33))}`);
    const twin = Uint8Array.from(bytes);
    twin.set(hexToBin((n - s).toString(16).padStart(64, '0')), 33);
    twin[0] = (((bytes[0]! - 27) ^ 1) & 3) + 27 + 4;
    const b64 = binToBase64(twin);
    expect(b64).not.toBe(sig);
    expect(verifyMessage(msg, b64, hash)).toBe(true);
  });

  it('frames CompactSize lengths at the encoding boundaries', () => {
    const prefixLen = 1 + 24;
    for (const [len, size] of [[252, 1], [253, 3], [65535, 3], [65536, 5]] as const) {
      expect(messageFraming('a'.repeat(len)).length).toBe(prefixLen + size + len);
    }
    expect(messageFraming('测试').length).toBe(prefixLen + 1 + 6);
  });
});

describe('CashAddr', () => {
  const q = 'bitcoincash:qqehccy89v7ftlfgr9v0zvhjzyy7eatdkqt05lt3nw';

  it('treats q… and z… forms of one key as the same controller', () => {
    const plain = parseCashAddr(q);
    if (isAddressError(plain)) throw new Error();
    const z = toggleTokenForm(plain)!;
    expect(z.startsWith('bitcoincash:z')).toBe(true);
    const token = parseCashAddr(z);
    if (isAddressError(token)) throw new Error();
    expect(token.tokenAware).toBe(true);
    expect(token.singleKey).toBe(true);
    expect(sameController(plain, token)).toBe(true);
    expect(lockingBytecodeHex(plain)).toBe(lockingBytecodeHex(token));
  });

  it('is strict inside statements and lenient for user input', () => {
    expect(parseCashAddr(q.toUpperCase())).toMatchObject({ error: 'address_invalid' });
    expect(parseCashAddr(q.split(':')[1])).toMatchObject({ error: 'address_invalid' });
    expect(parseCashAddr(`bitcoincash:qqehccy89v7ftlfgr9v0zvhjzyy7eatdkqt05lt3nW`)).toMatchObject({ error: 'address_invalid' });
    expect(parseCashAddr(q.replace('bitcoincash', 'bchtest'))).toMatchObject({ error: 'address_invalid' });
    expect(normalizeCashAddrInput(q.toUpperCase())).toMatchObject({ address: q });
    expect(normalizeCashAddrInput(q.split(':')[1]!)).toMatchObject({ address: q });
    expect(normalizeCashAddrInput(`${q}?amount=1`)).toMatchObject({ address: q });
    expect(normalizeCashAddrInput('bitcoincash:QQEHCCY89v7ftlfgr9v0zvhjzyy7eatdkqt05lt3nw')).toMatchObject({ error: 'address_invalid' });
  });

  it('marks P2SH as not provable by signature', () => {
    const p2sh = parseCashAddr('bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq');
    if (isAddressError(p2sh)) throw new Error(p2sh.detail);
    expect(p2sh.singleKey).toBe(false);
  });
});
