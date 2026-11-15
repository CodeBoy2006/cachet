/**
 * Bitcoin Signed Message, as implemented by Electron Cash, Cashonize and the
 * BCH WalletConnect `bch_signMessage` method.
 *
 *   hash = SHA256(SHA256( CompactSize(24) || "Bitcoin Signed Message:\n" || CompactSize(len) || UTF-8 message ))
 *   signature = base64( header || r || s ),  header = 27 + recid (+4 if the key is compressed)
 */
import { bigIntToCompactUint, binToHex, hash160, hash256, secp256k1 } from '@bitauth/libauth';
import { concatBytes, decodeBase64Strict, equalBytes, toBase64, utf8 } from './bytes.ts';

const MAGIC = utf8('Bitcoin Signed Message:\n');
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const compactSize = (n: number) => bigIntToCompactUint(BigInt(n));

export const messageFraming = (message: string): Uint8Array => {
  const body = utf8(message);
  return concatBytes(compactSize(MAGIC.length), MAGIC, compactSize(body.length), body);
};

export const messageHash = (message: string): Uint8Array => hash256(messageFraming(message));

export type RecoveredSigner = {
  ok: true;
  publicKey: Uint8Array;
  compressed: boolean;
  recoveryId: 0 | 1 | 2 | 3;
  /** HASH160 of the public key in the serialization the header selects. */
  publicKeyHash: Uint8Array;
};

export type RecoverError = {
  ok: false;
  code: 'bch_signature_malformed' | 'signature_invalid';
  detail: string;
};

const scalar = (bytes: Uint8Array) => BigInt(`0x${binToHex(bytes) || '0'}`);

export const recoverSigner = (message: string, signature: unknown): RecoveredSigner | RecoverError => {
  const raw = decodeBase64Strict(signature);
  if (!raw) return { ok: false, code: 'bch_signature_malformed', detail: 'not strict Base64' };
  if (raw.length !== 65) {
    return { ok: false, code: 'bch_signature_malformed', detail: `expected 65 bytes, got ${raw.length}` };
  }
  const header = raw[0]!;
  if (header < 27 || header > 34) {
    return { ok: false, code: 'bch_signature_malformed', detail: `header byte ${header} outside 27–34` };
  }
  const compact = raw.slice(1);
  const r = scalar(compact.slice(0, 32));
  const s = scalar(compact.slice(32));
  if (r === 0n || s === 0n || r >= CURVE_N || s >= CURVE_N) {
    return { ok: false, code: 'bch_signature_malformed', detail: 'r or s out of range' };
  }
  const compressed = header >= 31;
  const recoveryId = ((header - 27) & 3) as 0 | 1 | 2 | 3;
  const hash = messageHash(message);
  const publicKey = compressed
    ? secp256k1.recoverPublicKeyCompressed(compact, recoveryId, hash)
    : secp256k1.recoverPublicKeyUncompressed(compact, recoveryId, hash);
  if (typeof publicKey === 'string') {
    return { ok: false, code: 'signature_invalid', detail: 'no public key recovers from this signature' };
  }
  // verifySignatureCompact normalizes S, so high-S signatures from older signers stay valid.
  if (!secp256k1.verifySignatureCompact(compact, publicKey, hash)) {
    return { ok: false, code: 'signature_invalid', detail: 'signature does not verify' };
  }
  return { ok: true, publicKey, compressed, recoveryId, publicKeyHash: hash160(publicKey) };
};

/** True when `signature` over `message` was made by the key behind `publicKeyHash`. */
export const verifyMessage = (message: string, signature: string, publicKeyHash: Uint8Array): boolean => {
  const recovered = recoverSigner(message, signature);
  return recovered.ok && equalBytes(recovered.publicKeyHash, publicKeyHash);
};

/** Deterministic (RFC 6979) signing. Used by sandbox keys and tests only. */
export const signMessage = (privateKey: Uint8Array, message: string, compressed = true): string => {
  const sig = secp256k1.signMessageHashRecoverableCompact(privateKey, messageHash(message));
  if (typeof sig === 'string') throw new Error(sig);
  const header = 27 + sig.recoveryId + (compressed ? 4 : 0);
  return toBase64(concatBytes(Uint8Array.of(header), sig.signature));
};
