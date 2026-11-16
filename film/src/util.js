export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0 → 1 as t goes from a to b. */
export const seg = (t, a, b) => clamp((t - a) / (b - a));
/** Rises a→b, holds, falls c→d. */
export const window4 = (t, a, b, c, d) => Math.min(seg(t, a, b), 1 - seg(t, c, d));

/** CSS-style cubic-bezier easing. */
export const bezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-6) break;
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    t = clamp(t);
    return sy(t);
  };
};

export const ease = {
  linear: (x) => x,
  inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x) => x ** 4,
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  outQuint: (x) => 1 - (1 - x) ** 5,
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  outBack: (x) => {
    const c1 = 1.5;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  },
  /** Fast settle with a small overshoot, for stamps and impacts. */
  stamp: bezier(0.22, 1.26, 0.36, 1),
  /** Long, cinematic in-out. */
  film: bezier(0.65, 0, 0.25, 1),
  glide: bezier(0.45, 0.05, 0.2, 1),
};

/** Deterministic PRNG. */
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Stable hash → [0, 1). */
export const hash1 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Keyframe track: [{t, ...values, ease?}], ease applies on the way into a key.
 * `log` lists properties interpolated in log space (zoom).
 */
export const track = (input, log = []) => {
  // Fill every key with every property: carry forward, then back-fill leading gaps.
  const names = [...new Set(input.flatMap((k) => Object.keys(k).filter((n) => n !== 't' && n !== 'ease')))];
  const keys = input.map((k) => ({ ...k }));
  for (const n of names) {
    let last;
    for (const k of keys) {
      if (typeof k[n] === 'number') last = k[n];
      else if (last !== undefined) k[n] = last;
    }
    const first = keys.find((k) => typeof k[n] === 'number')?.[n];
    for (const k of keys) if (k[n] === undefined) k[n] = first;
  }
  return sample(keys, log);
};

const sample = (keys, log) => (t) => {
  if (t <= keys[0].t) return { ...keys[0] };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { ...last };
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const e = (b.ease ?? ease.inOutSine)(seg(t, a.t, b.t));
  const out = { t };
  for (const k of Object.keys(b)) {
    if (k === 't' || k === 'ease' || typeof b[k] !== 'number') continue;
    const va = a[k] ?? b[k];
    out[k] = log.includes(k) ? Math.exp(lerp(Math.log(va), Math.log(b[k]), e)) : lerp(va, b[k], e);
  }
  for (const k of Object.keys(a)) if (!(k in out) && typeof a[k] === 'number' && k !== 't') out[k] = a[k];
  return out;
};

export const midi = (n) => 440 * 2 ** ((n - 69) / 12);
