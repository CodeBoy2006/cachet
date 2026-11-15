/**
 * The seal's emblem: y² = x³ + 7, the curve every Bitcoin, Bitcoin Cash and Nostr key
 * lives on (secp256k1). Keys are really points over a 256-bit prime field; this draws the
 * same equation over the reals and places each key by its true x-coordinate, so every
 * identity lands on its own pair of points. A picture, not a computation.
 */

export const CURVE_B = 7;
const VERTEX = -Math.cbrt(CURVE_B);

/** Seal emblem space: X = (x − shift)·k, Y = −y·k (SVG y points down). */
const K = 7.6;
const SHIFT = 0.3;
const X_MAX = 2.8;
/** Keys are spread over this part of the curve so they never sit on the vertex or the clipped tips. */
const SPAN: [number, number] = [-1.45, 2.3];

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const toX = (x: number) => (x - SHIFT) * K;

/** Upper and lower branches, each starting at the vertex so they can be drawn outward. */
export const curvePaths = () => {
  const n = 96;
  let up = '';
  let down = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    // u² spacing: dense near the vertex, where the curve turns vertical.
    const x = VERTEX + (X_MAX - VERTEX) * u * u;
    const y = Math.sqrt(Math.max(0, x ** 3 + CURVE_B)) * K;
    up += `${i ? 'L' : 'M'}${f(toX(x))} ${f(-y)}`;
    down += `${i ? 'L' : 'M'}${f(toX(x))} ${f(y)}`;
  }
  return { up, down };
};

/** Axis ticks at integer x, as on a printed plate. */
export const axisTicks = () => [-1, 0, 1, 2].map((x) => toX(x));
export const yAxisX = toX(0);

export interface CurvePoint {
  X: number;
  Y: number;
}

const fraction = (hex: string) => parseInt(hex.slice(0, 12), 16) / 2 ** 48;

const place = (xHex: string, odd: boolean): CurvePoint => {
  const x = SPAN[0] + fraction(xHex) * (SPAN[1] - SPAN[0]);
  const y = Math.sqrt(x ** 3 + CURVE_B) * (odd ? -1 : 1);
  return { X: toX(x), Y: -y * K };
};

/** BIP-340 public keys are x-only with an implied even y: always the upper branch here. */
export const nostrPoint = (pubkey: string): CurvePoint | undefined =>
  /^[0-9a-f]{64}$/.test(pubkey) ? place(pubkey, false) : undefined;

/** Compressed SEC key: 02 = even y (upper), 03 = odd y (lower). */
export const bchPoint = (publicKeyHex?: string): CurvePoint | undefined =>
  publicKeyHex && /^0[23][0-9a-f]{64}$/.test(publicKeyHex) ? place(publicKeyHex.slice(2), publicKeyHex.startsWith('03')) : undefined;

/** secp256k1 domain parameters, set as microprint along the card. */
export const CURVE_MICROPRINT =
  'secp256k1 · y² = x³ + 7 · p = FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFE FFFFFC2F · ' +
  'n = FFFFFFFF FFFFFFFF FFFFFFFF FFFFFFFE BAAEDCE6 AF48A03B BFD25E8C D0364141 · ' +
  'G = 79BE667E F9DCBBAC 55A06295 CE870B07 029BFCDB 2DCE28D9 59F2815B 16F81798, ' +
  '483ADA77 26A3C465 5DA4FBFC 0E1108A8 FD17B448 A6855419 9C47D08F FB10D4B8 · ';
