import { base64ToBin, binToBase64, binToHex, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';

export { binToHex, hexToBin };

const LOWER_HEX = /^[0-9a-f]*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const isLowerHex = (value: unknown, bytes?: number): value is string =>
  typeof value === 'string' &&
  value.length % 2 === 0 &&
  (bytes === undefined || value.length === bytes * 2) &&
  LOWER_HEX.test(value);

export const utf8 = (text: string): Uint8Array => utf8ToBin(text);

export const utf8Length = (text: string): number => utf8ToBin(text).length;

export const sha256Hex = (data: Uint8Array | string): string =>
  binToHex(sha256.hash(typeof data === 'string' ? utf8ToBin(data) : data));

/**
 * Strict standard Base64: correct alphabet, padded length, and canonical
 * re-encoding (rejects non-zero padding bits and whitespace).
 */
export const decodeBase64Strict = (value: unknown): Uint8Array | null => {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return null;
  if (!BASE64.test(value)) return null;
  const bin = base64ToBin(value);
  return binToBase64(bin) === value ? bin : null;
};

export const toBase64 = (bytes: Uint8Array): string => binToBase64(bytes);

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return binToHex(buf);
};

export const isSafeUnixSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
