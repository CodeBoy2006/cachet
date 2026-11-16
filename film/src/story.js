import * as THREE from 'three';
import { ACT, TYPE, CHECKS, RELAYS, TABLE, ATTACK, S16, DURATION } from './cues.js';
import { clamp, ease, lerp, seg, track, window4, hash1 } from './util.js';
import { FONT } from './press.js';
import { Card, Foil, Print } from './objects.js';

export const C = {
  paper: '#ebe5d8',
  ink: '#1d1b18',
  ink2: '#5a564e',
  graphite: '#8f897d',
  violet: '#5b3fd2',
  green: '#0a8a5c',
  red: '#c4361c',
};

const R = 215; // ring radius
const L0 = 272; // ring half-separation when apart
const LOCK_D = R * 0.4615; // brand proportion (6:13)
const RING_W = 22;
const TAU = Math.PI * 2;

const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
const shortMid = (s, a, b) => `${s.slice(0, a)}…${s.slice(-b)}`;

// ---------------------------------------------------------------------------
// Camera, light and lens tracks
// ---------------------------------------------------------------------------
const camera = track(
  [
    { t: 0, x: -720, y: 0, h: 250, pitch: 36, yaw: -18, roll: 0 },
    { t: 0.55, x: -700, y: 0, h: 240, pitch: 35, yaw: -17, ease: ease.inSine },
    { t: 2.9, x: 560, y: 0, h: 215, pitch: 31, yaw: -12, ease: ease.linear },
    { t: 4.5, x: 0, y: -20, h: 860, pitch: 5, yaw: 0, roll: 0, ease: ease.inOutCubic },
    { t: 6.7, x: 0, y: -10, h: 820, pitch: 3, yaw: 1.5 },
    { t: 8.6, x: 0, y: 70, h: 1120, pitch: 0, yaw: 0, ease: ease.film },
    { t: 16.2, x: 0, y: 130, h: 1180, pitch: 4, yaw: -1.5 },
    { t: 19.5, x: 0, y: 30, h: 800, pitch: 0, yaw: 0, ease: ease.inOutCubic },
    { t: 20.0, x: 0, y: 20, h: 760, pitch: 0, yaw: 0 },
    { t: 21.9, x: 0, y: 30, h: 700, pitch: 10, yaw: -5 },
    { t: 23.5, x: 40, y: 40, h: 1120, pitch: 32, yaw: -12, ease: ease.inOutCubic },
    { t: 25.3, x: 120, y: 10, h: 1240, pitch: 30, yaw: -6 },
    { t: 26.6, x: 1150, y: 10, h: 1020, pitch: 14, yaw: 0, ease: ease.inOutCubic },
    { t: 29.6, x: 1190, y: 20, h: 960, pitch: 12, yaw: 2 },
    { t: 30.6, x: 2290, y: 20, h: 900, pitch: 14, yaw: 4, ease: ease.film },
    { t: 33.3, x: 2560, y: 60, h: 680, pitch: 12, yaw: 2 },
    { t: 34.3, x: 3830, y: 40, h: 780, pitch: 12, yaw: -3, ease: ease.film },
    { t: 35.95, x: 3840, y: 40, h: 750, pitch: 11, yaw: -2 },
    { t: 36.6, x: 4590, y: 40, h: 800, pitch: 12, yaw: 2, ease: ease.inOutCubic },
    { t: 37.6, x: 4600, y: 40, h: 780 },
    { t: 38.65, x: 4025, y: 70, h: 1300, pitch: 18, yaw: 0, ease: ease.inOutCubic },
    { t: 40.7, x: 4025, y: 90, h: 1240, pitch: 16 },
    { t: 42.0, x: 3830, y: 110, h: 600, pitch: 12, yaw: -2, ease: ease.inOutCubic },
    { t: 42.45, x: 3830, y: 115, h: 580 },
    { t: 43.25, x: 2250, y: 1460, h: 860, pitch: 4, yaw: 0, ease: ease.film },
    { t: 44.9, x: 2280, y: 1470, h: 830 },
    { t: 45.6, x: 3350, y: 1460, h: 860, ease: ease.inOutCubic },
    { t: 47.4, x: 3380, y: 1470, h: 830 },
    { t: 48.1, x: 4450, y: 1460, h: 860, ease: ease.inOutCubic },
    { t: 49.9, x: 4480, y: 1470, h: 830 },
    { t: 50.5, x: 3350, y: 2270, h: 880, pitch: 3, ease: ease.inOutCubic },
    { t: 52.45, x: 3350, y: 2280, h: 850, pitch: 3 },
    { t: 54.0, x: 2000, y: 900, h: 3700, pitch: 0, yaw: 0, ease: ease.inOutCubic },
    { t: 55.7, x: 290, y: 20, h: 1000, pitch: 0, yaw: 0, ease: ease.inOutCubic },
    { t: DURATION, x: 290, y: 20, h: 930, pitch: 0, yaw: 0 },
  ],
  ['h'],
);

const light = track([
  { t: 0, exposure: 1, key: 0.0, hemi: 0.0, env: 0, spot: 0, spotAngle: 0.055, spotX: -560, spotY: 0, az: 128, el: 27, warm: 1 },
  { t: 0.12, spot: 0 },
  { t: 0.3, spot: 3.6, ease: ease.outExpo },
  { t: 0.55, spotX: -540 },
  { t: 2.9, spot: 3.6, spotX: 560, spotAngle: 0.07, ease: ease.linear },
  { t: 4.5, spot: 3.2, spotX: 0, spotAngle: 0.17, key: 0.28, env: 0.08, hemi: 0.12, ease: ease.inOutCubic },
  { t: 8.6, spot: 2.4, spotAngle: 0.2, key: 1.12, env: 0.22, hemi: 0.36 },
  { t: 16.2, spot: 1.4, key: 1.57, env: 0.3, hemi: 0.48, az: 132 },
  { t: 19.5, spot: 0.4, key: 1.01, env: 0.18, hemi: 0.24, az: 136 },
  { t: 19.99, spot: 0, key: 0.95, env: 0.16, hemi: 0.24 },
  { t: 20.06, spot: 0, key: 4.03, env: 0.75, hemi: 0.84, az: 138, ease: ease.outExpo },
  { t: 21.2, key: 2.91, env: 0.55, hemi: 0.72, az: 120, el: 30 },
  { t: 30, key: 2.8, env: 0.55, hemi: 0.72, az: 116, el: 34 },
  { t: 42.2, key: 2.8, env: 0.55, hemi: 0.72, az: 112, el: 34, warm: 1 },
  { t: 43.2, key: 1.79, env: 0.32, hemi: 0.38, az: 150, el: 26, warm: 0, ease: ease.inOutCubic },
  { t: 52.2, key: 1.79, env: 0.32, hemi: 0.38, az: 150, el: 26, warm: 0 },
  { t: 53.4, key: 3.02, env: 0.6, hemi: 0.72, az: 128, el: 30, warm: 1.25, ease: ease.inOutCubic },
  { t: 55.0, key: 3.25, env: 0.6, hemi: 0.72, az: 122, el: 24 },
  { t: 58.6, key: 3.02, env: 0.55, hemi: 0.72, az: 104, el: 21, exposure: 1 },
  { t: 61.3, key: 0.45, env: 0.1, hemi: 0.12, az: 98, el: 18, exposure: 0, ease: ease.inOutSine },
]);

const post = track([
  { t: 0, aperture: 80, vignette: 0.5, grain: 0.055 },
  { t: 2.9, aperture: 70, vignette: 0.5 },
  { t: 4.4, aperture: 0, vignette: 0.42 },
  { t: 8.6, aperture: 0, vignette: 0.34, grain: 0.045 },
  { t: 20.0, aperture: 0, vignette: 0.3, grain: 0.04 },
  { t: 22.2, aperture: 0 },
  { t: 23.4, aperture: 9 },
  { t: 25.6, aperture: 7 },
  { t: 26.6, aperture: 2 },
  { t: 30.5, aperture: 5 },
  { t: 42.0, aperture: 5, vignette: 0.3 },
  { t: 43.1, aperture: 0, vignette: 0.42, grain: 0.05 },
  { t: 52.2, aperture: 0, vignette: 0.42 },
  { t: 53.6, aperture: 0, vignette: 0.3, grain: 0.04 },
]);

const shakeAt = (t) => {
  let x = 0;
  let y = 0;
  for (const [t0, amp, f] of [
    [ACT.lock, 5, 23],
    [ACT.land, 2.4, 31],
    [ACT.stamp, 1.6, 27],
    [ACT.lockup, 1.2, 19],
  ]) {
    if (t < t0) continue;
    const k = Math.exp(-(t - t0) * 9) * amp;
    x += Math.sin((t - t0) * f * 6.1) * k;
    y += Math.cos((t - t0) * f * 4.7) * k;
  }
  return { x, y };
};

/** Phase of the beating between the two key tones (3.4 Hz slowing to 0.8 Hz). */
const beatPhase = (t) => {
  const c = ACT.converge;
  const e = ACT.breath;
  const f0 = 3.4;
  const f1 = 0.8;
  if (t <= c) return TAU * f0 * t;
  const u = Math.min(t, e) - c;
  let p = f0 * c + f0 * u - ((f0 - f1) * u * u) / (2 * (e - c));
  if (t > e) p += f1 * (t - e);
  return TAU * p;
};

// ---------------------------------------------------------------------------
// Stamps: rubber-stamp impressions rendered once, inked with a little unevenness.
// ---------------------------------------------------------------------------
function makeStamp(text, color, { size = 26, font = 'mono', weight = 600, track: tr = 0.06, pad = 16, seed = 1 } = {}) {
  const k = 4;
  const m = document.createElement('canvas').getContext('2d');
  m.font = `${weight} ${size * k}px ${FONT[font]}`;
  m.letterSpacing = `${tr * size * k}px`;
  const tw = m.measureText(text).width / k;
  const w = tw + pad * 2;
  const h = size * 1.9;
  const make = (fill) => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * k);
    c.height = Math.ceil(h * k);
    const g = c.getContext('2d');
    g.scale(k, k);
    g.strokeStyle = fill;
    g.fillStyle = fill;
    g.lineWidth = 2.6;
    g.beginPath();
    g.roundRect(2, 2, w - 4, h - 4, 6);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 3.5);
    g.stroke();
    g.font = `${weight} ${size}px ${FONT[font]}`;
    g.letterSpacing = `${tr * size}px`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(text, w / 2 + (tr * size) / 2, h / 2 + 1);
    // Uneven ink: knock tiny flecks out.
    g.globalCompositeOperation = 'destination-out';
    let s = seed * 9301;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h * 0.06; i++) {
      g.globalAlpha = 0.25 + r() * 0.6;
      g.beginPath();
      g.arc(r() * w, r() * h, 0.25 + r() * 0.9, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 0.12;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(r() * w, r() * h, 8 + r() * 30, 3 + r() * 6, r() * 3, 0, TAU);
      g.fill();
    }
    return c;
  };
  return { ink: make(color), relief: make('rgb(40,40,40)'), w, h };
}

// ---------------------------------------------------------------------------

export function createStory({ engine, data, images }) {
  const { scene, renderer } = engine;
  const ink = engine.press.ink;
  const rel = engine.press.relief;

  const foil = new Foil();
  scene.add(foil.mesh);
  const card = new Card(data, renderer);
  scene.add(card.group);

  const pay = new Print([images.pay], 640, renderer, { radius: 22 });
  const fieldnote = new Print([images['fieldnote-out'], images['fieldnote-in'], images['fieldnote-ended']], 900, renderer, { radius: 10 });
  const stall = new Print([images['stall-out'], images['stall-in'], images['stall-ended']], 900, renderer, { radius: 10 });
  const approve = new Print([images.approve], 340, renderer, { radius: 22 });
  for (const p of [pay, fieldnote, stall, approve]) scene.add(p.mesh);

  const stamps = {
    signature_invalid: makeStamp('signature_invalid', C.red, { seed: 3 }),
    pubkey_mismatch: makeStamp('pubkey_mismatch', C.red, { seed: 5 }),
    key_reuse: makeStamp('key_reuse', C.red, { seed: 7 }),
    withdrawn: makeStamp('WITHDRAWN', C.ink, { size: 34, font: 'sans', weight: 650, track: 0.22, pad: 24, seed: 11 }),
  };

  // Monospace advance, measured once.
  const adv = ink.measure('0000000000', { font: 'mono', size: 100 }) / 1000;

  const addr = data.cashaddr;
  const addrBody = addr.split(':')[1];
  const npub = data.npub;
  const serial = data.bindingId.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

  // Statement M, typeset with colour runs (npub violet, address green).
  const stmt = (() => {
    const [head, intro, json] = data.message.split('\n');
    const cols = 86;
    const rows = [];
    const runs = (s, color) => [...s].map((ch) => ({ ch, color }));
    rows.push(runs(head, C.ink));
    const at = intro.indexOf('npub1');
    rows.push(runs(intro.slice(0, at).trimEnd(), C.ink2));
    rows.push(runs(intro.slice(at), C.violet));
    const cells = [];
    const a0 = json.indexOf(addr);
    [...json].forEach((ch, i) => cells.push({ ch, color: i >= a0 && i < a0 + addr.length ? C.green : C.ink2 }));
    for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols));
    return rows;
  })();
  const STMT = { x: -405, y: 362, lh: 22, size: 14.5 };

  const drawRow = (L, row, x, y, size, count, alpha = 1) => {
    const a = adv * size;
    let i = 0;
    while (i < row.length && i < count) {
      let j = i;
      while (j < row.length && j < count && row[j].color === row[i].color) j++;
      L.text(row.slice(i, j).map((c) => c.ch).join(''), x + i * a, y, { font: 'mono', size, color: row[i].color, alpha });
      i = j;
    }
  };

  const ringSep = (t) => {
    if (t >= ACT.lock) return LOCK_D;
    const e = ease.inOutCubic(seg(t, ACT.converge + 0.35, ACT.breath - 0.1));
    return lerp(L0, 112, e);
  };
  const lockSnap = (t) => (t >= ACT.lock ? 1 : 0);

  // Ink lift at the finale: everything but the mark and the lockup fades from the fibres.
  const lift = (t) => 1 - seg(t, ACT.finale + 1.45, ACT.finale + 2.6);

  const caption = (L, s, x, y, t, a, b, o = {}) => {
    const r = seg(t, a, a + (o.dur ?? 0.65));
    const out = b ? 1 - seg(t, b, b + 0.3) : 1;
    const alpha = out * (o.alpha ?? 1);
    if (r <= 0 || alpha <= 0) return;
    L.text(s, x, y, {
      font: o.font ?? 'serif',
      size: o.size ?? 64,
      weight: o.weight ?? 400,
      align: o.align ?? 'center',
      color: o.color ?? C.ink,
      track: o.track ?? -0.01,
      reveal: ease.outCubic(r),
      alpha,
      depth: o.depth ?? 0.35,
    });
  };

  const check = (L, x, y, s, color, p = 1, width = 2.4) => {
    L.poly(
      [
        [x - s * 0.5, y],
        [x - s * 0.12, y + s * 0.38],
        [x + s * 0.55, y - s * 0.45],
      ],
      { color, width, progress: p, depth: 0.4 },
    );
  };

  // ======================================================================
  // Acts I & II — the string, two keys, one statement, the lock
  // ======================================================================
  function drawOpening(L, isRelief, t) {
    const lf = lift(t);
    const sz = 40;
    const a = adv * sz;
    const x0 = -(addr.length * a) / 2 + a / 2;
    const rotB = 0.06 * Math.max(0, t - ACT.curl);
    const rotN = -0.05 * Math.max(0, t - ACT.curl);
    const sep = ringSep(t);
    const solid = ease.inOutSine(seg(t, ACT.converge + 0.75, ACT.converge + 2.45));
    const curlEnd = ACT.curl + 1.15 + addr.length * 0.008;

    // ---- address: typed, then bent into the BCH ring like a strip of type ----
    if (!isRelief) {
      const n = addr.length;
      const e = ease.film(seg(t, ACT.curl, ACT.curl + 1.35));
      const k = e / R;
      const sp = lerp(a, TAU * R / n, e);
      const ax = lerp(0, sep, e);
      const ay = lerp(0, R, e);
      const rho = 0.05 * Math.max(0, t - (ACT.curl + 1.35));
      for (let i = 0; i < n; i++) {
        const ti = TYPE.start + i * TYPE.step;
        const appear = seg(t, ti, ti + 0.06);
        if (appear <= 0) continue;
        const sArc = (i - (n - 1) / 2) * sp;
        let x;
        let y;
        let rot;
        if (k < 1e-7) {
          x = ax + sArc;
          y = ay;
          rot = 0;
        } else {
          const phi = k * sArc + rho;
          x = ax + Math.sin(phi) / k;
          y = ay - (1 - Math.cos(phi)) / k;
          rot = -phi;
        }
        const frac = Math.abs(sArc) / ((n / 2) * sp);
        const fadeSolid = 1 - seg(solid, frac - 0.03, frac + 0.03);
        L.glyph(addr[i], x, y, {
          font: 'mono',
          size: lerp(sz, 30, e),
          weight: lerp(400, 500, e),
          rotate: rot,
          baseline: 'alphabetic',
          color: mix(C.ink, C.green, e),
          alpha: appear * fadeSolid * lf,
        });
      }
      // ---- npub written round the Nostr ring, from the top, anticlockwise ----
      const m = npub.length;
      const rhoN = -0.04 * Math.max(0, t - (ACT.curl + 1.35));
      for (let i = 0; i < m; i++) {
        const ti = ACT.curl + 0.4 + i * 0.0135;
        const appear = seg(t, ti, ti + 0.12);
        if (appear <= 0) continue;
        const phi = ((i - (m - 1) / 2) / m) * TAU + rhoN;
        const frac = Math.abs(i - (m - 1) / 2) / (m / 2);
        const fadeSolid = 1 - seg(solid, frac - 0.03, frac + 0.03);
        L.glyph(npub[i], -sep + R * Math.sin(phi), R * Math.cos(phi), {
          font: 'mono',
          size: 27,
          weight: 500,
          rotate: -phi,
          baseline: 'alphabetic',
          color: C.violet,
          alpha: appear * fadeSolid * lf,
        });
      }
    }

    // ---- Act I captions and claimants ----
    if (!isRelief || true) {
      caption(L, 'Whose is this?', 0, -150, t, 3.45, ACT.claim + 0.35, { font: 'italic', size: 76 });
      caption(L, 'Anyone can claim it.', 0, -150, t, ACT.claim + 0.7, ACT.curl - 0.1, { size: 72 });
    }
    if (!isRelief) {
      const people = [
        { x: -440, y: 200, c: '#b8894a', n: 'M', h: '@mika' },
        { x: 0, y: 232, c: '#55687d', n: 'J', h: '@jon.bch' },
        { x: 440, y: 200, c: '#a85638', n: 'S', h: '@sana' },
      ];
      people.forEach((p, i) => {
        const t0 = ACT.claim + 0.15 + i * 0.26;
        const a1 = seg(t, t0, t0 + 0.25) * (1 - seg(t, ACT.curl - 0.25, ACT.curl + 0.2));
        if (a1 <= 0) return;
        const line = ease.outCubic(seg(t, t0 + 0.08, t0 + 0.45));
        const ax = p.x * 0.62;
        L.line(p.x, p.y - 42, p.x + (ax - p.x) * line, p.y - 42 + (30 - (p.y - 42)) * line, { color: C.graphite, width: 1.6, alpha: a1 });
        L.dot(ax, 30, 3, { color: C.graphite, alpha: a1 * seg(line, 0.9, 1) });
        L.dot(p.x, p.y, 32 * ease.outBack(seg(t, t0, t0 + 0.3)), { color: p.c, alpha: a1 * 0.92 });
        L.text(p.n, p.x, p.y + 12, { font: 'italic', size: 34, align: 'center', color: '#f4efe4', alpha: a1, over: true });
        L.text(p.h, p.x, p.y + 70, { font: 'mono', size: 19, align: 'center', color: C.ink2, alpha: a1 });
      });
    }

    if (t < ACT.keys - 1) return;

    // ---- the rings ----
    const ringAlpha = 1;
    const beat = Math.sin(beatPhase(t)) * (t < ACT.breath ? 1.6 : 0) * (1 - solid);
    if (!isRelief) {
      // Hairline guides under the lettering, trembling with the beat between the tones.
      const g = seg(t, ACT.keys - 0.6, ACT.keys + 0.4) * (1 - solid);
      L.circle(-sep, 0, R + beat, { color: C.violet, width: 0.8, alpha: g * 0.45 });
      L.circle(sep, 0, R - beat, { color: C.green, width: 0.8, alpha: g * 0.45 });
    }
    // Solid strokes drawn round as the letters give way.
    if (solid > 0) {
      const w = t >= ACT.lock ? RING_W : lerp(10, RING_W, seg(t, ACT.breath - 1.2, ACT.lock));
      const dep = t >= ACT.lock ? 0.85 : 0;
      if (solid >= 0.999) {
        L.circle(-sep, 0, R, { color: C.ink, width: w, alpha: ringAlpha, depth: dep });
        L.circle(sep, 0, R, { color: C.ink, width: w, alpha: ringAlpha, depth: dep });
      } else {
        for (const cx of [-sep, sep]) {
          L.arc(cx, 0, R, Math.PI / 2, Math.PI, { color: C.ink, width: w, progress: solid, alpha: ringAlpha, depth: dep });
          L.arc(cx, 0, R, Math.PI / 2, -Math.PI, { color: C.ink, width: w, progress: solid, alpha: ringAlpha, depth: dep });
        }
      }
    }
    // Lens pressed into the paper under the foil.
    if (isRelief && t >= ACT.lock) {
      const d = sep;
      const hh = Math.sqrt(R * R - d * d);
      const an = Math.atan2(hh, d);
      const c = L.ctx;
      c.save();
      c.beginPath();
      c.arc(-d, 0, R, -an, an);
      c.arc(d, 0, R, Math.PI - an, Math.PI + an);
      c.closePath();
      c.fillStyle = L.depth(0.55);
      c.fill();
      c.restore();
    }

    // ---- labels ----
    if (!isRelief) {
      const la = seg(t, ACT.keys + 0.5, ACT.keys + 1.1) * (1 - seg(t, ACT.converge, ACT.converge + 0.5));
      L.text('NOSTR KEY', -sep, R + 82, { font: 'sans', weight: 600, size: 17, track: 0.3, align: 'center', color: C.violet, alpha: la });
      L.text('BCH WALLET', sep, R + 82, { font: 'sans', weight: 600, size: 17, track: 0.3, align: 'center', color: C.green, alpha: la });
    }

    // ---- signing ripples ----
    if (!isRelief) {
      for (const [ts, cx, col] of [
        [ACT.signBch, sep, C.green],
        [ACT.signNostr, -sep, C.violet],
      ]) {
        const r = seg(t, ts, ts + 0.7);
        if (r > 0 && r < 1) L.circle(cx, 0, R + ease.outCubic(r) * 46, { color: col, width: 2 * (1 - r), alpha: (1 - r) * 0.7 });
      }
    }

    // ---- statement ----
    caption(L, 'Both keys sign one statement.', 0, -312, t, ACT.statement + 0.1, ACT.converge + 0.2, { size: 62 });
    if (!isRelief && t >= ACT.statement && t < ACT.converge + 2.2) {
      const col = ease.inOutCubic(seg(t, ACT.converge + 0.1, ACT.converge + 0.65));
      const midY = STMT.y + 110;
      stmt.forEach((row, k) => {
        const t0 = ACT.statement + 0.18 + k * 0.11;
        const count = Math.floor(seg(t, t0, t0 + 0.38) * row.length);
        if (count <= 0) return;
        const y = lerp(STMT.y + k * STMT.lh, midY, col);
        if (col < 0.92) drawRow(L, row, STMT.x, y, STMT.size, count, (1 - col) ** 3);
      });
      // Signatures: each key signs, in its own ink.
      const sig = (label, value, color, ts, y) => {
        const n = Math.floor(seg(t, ts + 0.2, ts + 0.9) * value.length);
        const la = seg(t, ts, ts + 0.15);
        if (la <= 0) return;
        const yy = lerp(y, midY, col);
        if (col >= 0.92) return;
        L.text(label, STMT.x, yy, { font: 'sans', weight: 600, size: 11.5, track: 0.2, color, alpha: la * (1 - col) ** 3 });
        L.text(value.slice(0, n), STMT.x + 150, yy, { font: 'mono', size: STMT.size, color, alpha: (1 - col) ** 3 });
      };
      const sy = STMT.y + stmt.length * STMT.lh + 18;
      sig('BCH · ECDSA', `${data.bchSignature.slice(0, 66)}…`, C.green, ACT.signBch, sy);
      sig('NOSTR · SCHNORR', `${data.nostrSig.slice(0, 66)}…`, C.violet, ACT.signNostr, sy + 26);
      // The statement collapses to its hash: binding ID = SHA-256(M).
      const hashA = seg(t, ACT.converge + 0.5, ACT.converge + 0.95);
      if (hashA > 0) {
        const n = Math.floor(hashA * 64);
        const toId = ease.inOutCubic(seg(t, ACT.converge + 1.2, ACT.converge + 1.8));
        const y = lerp(midY - 20, R + 92, toId);
        L.text('SHA-256 ( statement )', 0, y - 40, { font: 'sans', weight: 600, size: 13, track: 0.24, color: C.graphite, align: 'center', alpha: hashA * (1 - toId) });
        L.text(data.bindingId.slice(0, n).padEnd(64, ' '), 0, y, { font: 'mono', size: lerp(22, 17, toId), color: C.ink, align: 'center', alpha: 1 - toId });
      }
    }
    // Binding ID set under the mark.
    {
      const a1 = seg(t, ACT.converge + 1.55, ACT.converge + 1.9) * lf;
      if (a1 > 0 && !isRelief) {
        L.text('ID', -128, R + 92, { font: 'mono', size: 13, color: C.graphite, track: 0.14, alpha: a1, align: 'right' });
        L.text(serial, -112, R + 92, { font: 'mono', size: 18, color: C.ink2, track: 0.08, alpha: a1 });
      }
    }

    // ---- compass construction ----
    if (!isRelief && t >= ACT.converge) {
      const k = lf * (t < ACT.lock ? 1 : lerp(1, 0.32, seg(t, ACT.lock, ACT.lock + 1.2)));
      const d = sep;
      const hh = d < R ? Math.sqrt(R * R - d * d) : 0;
      const g = { color: C.graphite, width: 1, alpha: 0.85 * k };
      L.line(-d - R - 90, 0, d + R + 90, 0, { ...g, dash: [5, 7], progress: ease.inOutSine(seg(t, ACT.converge + 1.3, ACT.converge + 2.6)) });
      L.line(0, -R - 70, 0, R + 50, { ...g, dash: [5, 7], progress: ease.inOutSine(seg(t, ACT.converge + 1.7, ACT.converge + 2.9)) });
      if (hh > 0) {
        L.poly([[-d, 0], [0, -hh], [d, 0], [0, hh], [-d, 0]], { ...g, progress: ease.inOutSine(seg(t, ACT.converge + 2.1, ACT.converge + 3.1)) });
      }
      const cr = seg(t, ACT.converge + 1.2, ACT.converge + 1.6);
      for (const cx of [-d, d]) {
        L.line(cx - 8, 0, cx + 8, 0, { ...g, width: 1.4, alpha: g.alpha * cr });
        L.line(cx, -8, cx, 8, { ...g, width: 1.4, alpha: g.alpha * cr });
      }
      // Compass arcs swung from each centre through the other.
      const arcP = ease.inOutSine(seg(t, ACT.converge + 1.5, ACT.converge + 2.8));
      L.arc(-d, 0, 2 * d, -0.55, 1.1, { ...g, progress: arcP, alpha: g.alpha * 0.8 });
      L.arc(d, 0, 2 * d, Math.PI - 0.55, 1.1, { ...g, progress: arcP, alpha: g.alpha * 0.8 });
    }
  }

  // ======================================================================
  // Act III — relays and verification
  // ======================================================================
  const RELAY_NAMES = ['relay.damus.io', 'nos.lol', 'relay.primal.net', 'nostr.wine', 'relay.snort.social', 'offchain.pub'];
  const relayPos = RELAY_NAMES.map((_, i) => {
    const u = (i / (RELAY_NAMES.length - 1)) * 2 - 1;
    return [u * 760, -390 - Math.cos(u * 1.2) * 170];
  });

  function drawRelays(L, isRelief, t) {
    if (t < ACT.relays - 0.3 || isRelief) return;
    const lf = lift(t);
    caption(L, 'Lives on Nostr relays.', 0, 400, t, ACT.relays - 0.1, null, { size: 62, alpha: lf });
    relayPos.forEach(([x, y], i) => {
      const ts = RELAYS.start + i * RELAYS.step;
      const pr = ease.inOutCubic(seg(t, ts - 0.42, ts));
      if (pr <= 0) return;
      const sx = lerp(-300, 300, i / (RELAY_NAMES.length - 1));
      const sy = -card.size.h / 2 - 8;
      const pts = [];
      for (let j = 0; j <= 30; j++) {
        const u = j / 30;
        pts.push([lerp(sx, x, u), lerp(sy, y + 30, u) - Math.sin(u * Math.PI) * 26]);
      }
      L.poly(pts, { color: C.graphite, width: 1.3, progress: pr, alpha: 0.8 * lf });
      const arr = seg(t, ts - 0.04, ts + 0.12);
      L.dot(x, y + 30, 6 * ease.outBack(arr), { color: C.green, alpha: arr * lf });
      L.text(RELAY_NAMES[i], x, y + 2, { font: 'mono', size: 25, align: 'center', color: C.ink, alpha: arr * lf, reveal: ease.outCubic(seg(t, ts, ts + 0.35)) });
    });
  }

  function drawVerify(L, isRelief, t) {
    if (t < ACT.verify - 0.2) return;
    const lf = lift(t);
    const X = 860;
    caption(L, 'Anyone can verify it.', X, -262, t, ACT.verify + 0.15, null, { size: 58, align: 'left', alpha: lf });
    caption(L, 'No server to trust.', X, -200, t, ACT.verify + 0.75, null, { size: 42, font: 'italic', align: 'left', color: C.ink2, alpha: lf });
    if (isRelief) return;
    const rows = data.checks;
    rows.forEach((c, i) => {
      const ts = CHECKS.start + i * CHECKS.step;
      const y = -128 + i * 42;
      const a1 = seg(t, ts - 0.12, ts) * lf;
      if (a1 <= 0) return;
      L.line(X, y + 16, X + 460, y + 16, { color: C.graphite, width: 0.7, alpha: 0.4 * a1 });
      L.text(c.label, X + 44, y + 6, { font: 'sans', size: 23, color: C.ink, alpha: a1 });
      check(L, X + 12, y - 1, 17, C.green, ease.outCubic(seg(t, ts, ts + 0.12)), 2.6);
    });
    const qed = CHECKS.start + 9 * CHECKS.step + S16;
    const qa = seg(t, qed, qed + 0.08) * lf;
    if (qa > 0) {
      const s = 15 * ease.stamp(seg(t, qed, qed + 0.25));
      L.rect(X + 460 - s, -128 + 9 * 42 + 4 - s / 2, s, s, { fill: C.ink, alpha: qa });
    }
  }

  // ======================================================================
  // Act IV — captions under the prints
  // ======================================================================
  function drawUse(L, isRelief, t) {
    if (t < ACT.pay - 0.4) return;
    const lf = lift(t);
    caption(L, 'Pay a person,', 1700, -30, t, ACT.pay + 0.3, null, { size: 70, align: 'left', alpha: lf });
    caption(L, 'not a string.', 1700, 50, t, ACT.pay + 0.75, null, { size: 70, align: 'left', font: 'italic', alpha: lf });
    caption(L, 'One identity. Every app.', 4025, -262, t, ACT.apps + 0.25, ACT.withdraw - 0.25, { size: 64 });
    caption(L, 'Withdraw once. Every app lets go.', 4025, -262, t, ACT.withdraw + 0.15, null, { size: 64, alpha: lf });
    const st = stamps.withdrawn;
    const s = seg(t, ACT.stamp - 0.05, ACT.stamp);
    if (s > 0) {
      const sc = lerp(1.35, 1, ease.stamp(seg(t, ACT.stamp - 0.05, ACT.stamp + 0.12)));
      L.image(st.ink, 4025, 440, st.w * 1.5, st.h * 1.5, { rotate: -0.06, scale: sc, alpha: s * 0.92 * lf, reliefImage: st.relief });
    }
  }

  // ======================================================================
  // Act V — forgeries
  // ======================================================================
  const curve = (() => {
    const VERTEX = -Math.cbrt(7);
    const up = [];
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const x = VERTEX + (2.9 - VERTEX) * u * u;
      up.push([x, Math.sqrt(Math.max(0, x ** 3 + 7))]);
    }
    return up;
  })();
  const pxKey = (() => {
    const f = parseInt(data.pubkey.slice(0, 12), 16) / 2 ** 48;
    const x = -1.2 + f * 3.4;
    return [x, Math.sqrt(x ** 3 + 7)];
  })();

  function attackPanel(L, isRelief, t, a, cx, title, rows, code, seed) {
    if (t < a - 0.5) return;
    const lf = lift(t);
    caption(L, title, cx, 1255, t, a + ATTACK.caption, null, { size: 58, alpha: lf });
    if (isRelief) {
      const st = stamps[code];
      const s = seg(t, a + ATTACK.code - 0.05, a + ATTACK.code);
      if (s > 0) L.image(st.ink, cx + 150, 1640, st.w * 1.25, st.h * 1.25, { rotate: -0.05, alpha: s * lf, reliefImage: st.relief });
      return;
    }
    const left = cx - 380;
    rows.forEach((r, i) => {
      const y = 1370 + i * 112;
      const a1 = seg(t, a + 0.35 + i * 0.22, a + 0.6 + i * 0.22) * lf;
      L.text(r.label, left, y, { font: 'sans', weight: 600, size: 14, track: 0.22, color: C.graphite, alpha: a1 });
      L.text(r.value, left, y + 42, { font: 'mono', size: r.size ?? 26, color: r.color, alpha: a1, reveal: ease.outCubic(seg(t, a + 0.4 + i * 0.22, a + 0.85 + i * 0.22)) });
    });
    const m = seg(t, a + ATTACK.mark, a + ATTACK.mark + 0.42);
    if (m > 0) {
      const w = L.measure(rows[1].value, { font: 'mono', size: rows[1].size ?? 26 });
      L.loop(left + w / 2, 1370 + 112 + 38, w / 2 + 30, 31, { color: C.red, width: 3.4, progress: ease.inOutSine(m), alpha: 0.9 * lf, seed });
      L.text('≠', left - 60, 1370 + 84, { font: 'serif', size: 70, color: C.red, alpha: seg(m, 0.5, 0.9) * lf, align: 'center' });
    }
    const s = seg(t, a + ATTACK.code - 0.05, a + ATTACK.code);
    if (s > 0) {
      const st = stamps[code];
      const sc = lerp(1.4, 1, ease.stamp(seg(t, a + ATTACK.code - 0.05, a + ATTACK.code + 0.12)));
      L.image(st.ink, cx + 150, 1640, st.w * 1.25, st.h * 1.25, { rotate: -0.05, scale: sc, alpha: s * 0.92 * lf });
    }
  }

  function drawMirror(L, isRelief, t) {
    const a = ACT.mirror;
    if (t < a - 0.5) return;
    const lf = lift(t);
    const cx = 4450;
    caption(L, 'Mirror the key.', cx, 1255, t, a + ATTACK.caption, null, { size: 58, alpha: lf });
    if (isRelief) {
      const st = stamps.key_reuse;
      const s = seg(t, a + ATTACK.code - 0.05, a + ATTACK.code);
      if (s > 0) L.image(st.ink, cx + 210, 1660, st.w * 1.25, st.h * 1.25, { rotate: -0.05, alpha: s * lf, reliefImage: st.relief });
      return;
    }
    const ox = cx - 60;
    const oy = 1475;
    const k = 46;
    const draw = ease.inOutSine(seg(t, a + 0.25, a + 1.0));
    const g = { color: C.graphite, width: 1, alpha: 0.7 * lf };
    L.line(ox - 120, oy, ox + 220, oy, { ...g, progress: draw });
    L.line(ox, oy - 190, ox, oy + 190, { ...g, progress: draw });
    const up = curve.map(([x, y]) => [ox + x * k, oy - y * k * 0.62]);
    const dn = curve.map(([x, y]) => [ox + x * k, oy + y * k * 0.62]);
    L.poly(up, { color: C.ink, width: 2.4, progress: draw, alpha: lf });
    L.poly(dn, { color: C.ink, width: 2.4, progress: draw, alpha: lf });
    L.text('y² = x³ + 7', ox + 120, oy - 150, { font: 'italic', size: 26, color: C.ink2, alpha: seg(t, a + 0.7, a + 1.1) * lf });
    const px = ox + pxKey[0] * k;
    const py = oy - pxKey[1] * k * 0.62;
    const pa = seg(t, a + 0.75, a + 0.95) * lf;
    L.dot(px, py, 8, { color: C.violet, alpha: pa });
    L.text('Nostr key', px - 16, py - 18, { font: 'sans', weight: 600, size: 14, track: 0.12, color: C.violet, align: 'right', alpha: pa });
    const qa = seg(t, a + 1.0, a + 1.2) * lf;
    const qy = oy + pxKey[1] * k * 0.62;
    if (qa > 0) {
      const c = L.ctx;
      c.save();
      c.globalAlpha = qa;
      c.fillStyle = C.green;
      c.translate(px, qy);
      c.rotate(Math.PI / 4);
      c.fillRect(-7, -7, 14, 14);
      c.restore();
      L.text('BCH key = n − d', px - 18, qy + 34, { font: 'sans', weight: 600, size: 14, track: 0.12, color: C.green, align: 'right', alpha: qa });
    }
    const m = seg(t, a + ATTACK.mark, a + ATTACK.mark + 0.4);
    L.line(px, py + 12, px, qy - 12, { color: C.red, width: 2.6, dash: [7, 6], progress: ease.inOutSine(m), alpha: lf });
    L.text('same x', px + 16, oy - 8, { font: 'sans', weight: 600, size: 15, track: 0.16, color: C.red, alpha: seg(m, 0.6, 1) * lf });
    const s = seg(t, a + ATTACK.code - 0.05, a + ATTACK.code);
    if (s > 0) {
      const st = stamps.key_reuse;
      const sc = lerp(1.4, 1, ease.stamp(seg(t, a + ATTACK.code - 0.05, a + ATTACK.code + 0.12)));
      L.image(st.ink, cx + 210, 1660, st.w * 1.25, st.h * 1.25, { rotate: -0.05, scale: sc, alpha: s * 0.92 * lf });
    }
  }

  const LAB = [
    ['Honest binding', 'ok'],
    ['Claim someone else’s address', 'signature_invalid'],
    ['Replay a proof under another npub', 'pubkey_mismatch'],
    ['Unverified 30078 announcement', 'wrong_kind'],
    ['Edit after signing', 'event_id_mismatch'],
    ['Trust a cached check', 'event_id_mismatch'],
    ['One key for both sides', 'key_reuse'],
    ['Mirrored key (d and n − d)', 'key_reuse'],
    ['Expired', 'expired'],
    ['Wrong network', 'network_mismatch'],
    ['Non-canonical proof', 'proof_not_canonical'],
    ['Contract address', 'unsupported_address_type'],
  ];

  function drawTable(L, isRelief, t) {
    if (t < ACT.table - 0.4) return;
    const lf = lift(t);
    const cx = 3350;
    caption(L, 'Only the real one passes.', cx, 2050, t, ACT.table + 0.1, null, { size: 62, alpha: lf });
    if (isRelief) return;
    LAB.forEach(([title, code], i) => {
      const ts = TABLE.start + i * TABLE.step;
      const a1 = seg(t, ts - 0.02, ts + 0.05) * lf;
      if (a1 <= 0) return;
      const y = 2130 + i * 33;
      L.line(cx - 470, y + 12, cx + 470, y + 12, { color: C.graphite, width: 0.6, alpha: 0.35 * a1 });
      L.text(String(i + 1).padStart(2, '0'), cx - 470, y, { font: 'mono', size: 14, color: C.graphite, alpha: a1 });
      L.text(title, cx - 428, y, { font: 'sans', size: 20, color: C.ink, alpha: a1 });
      const sc = lerp(1.25, 1, ease.stamp(seg(t, ts, ts + 0.12)));
      if (code === 'ok') {
        check(L, cx + 455, y - 6, 14, C.green, ease.outCubic(seg(t, ts, ts + 0.15)), 2.4);
        L.text('ok', cx + 432, y, { font: 'mono', size: 18, color: C.green, align: 'right', alpha: a1 });
      } else {
        L.text(code, cx + 470, y, { font: 'mono', weight: 500, size: 18, color: C.red, align: 'right', alpha: a1, scale: sc });
      }
    });
  }

  // ======================================================================
  // Act VI — lockup
  // ======================================================================
  function drawLockup(L, isRelief, t) {
    if (t < ACT.lockup - 0.1) return;
    const x = 372;
    caption(L, 'cachet', x, 50, t, ACT.lockup + 0.05, null, { font: 'sans', weight: 620, size: 156, align: 'left', track: -0.03, depth: 0.7, dur: 0.75 });
    caption(L, 'Both keys sign. Anyone verifies.', x + 6, 128, t, ACT.lockup + 0.7, null, { font: 'italic', size: 40, align: 'left', color: C.ink2, depth: 0.25 });
    caption(L, 'BCH BLAZE 2026', 290, 400, t, ACT.lockup + 1.35, null, { font: 'mono', size: 15, track: 0.36, color: C.graphite, depth: 0.15, dur: 0.6 });
  }

  // ---------------------------------------------------------------------------
  const placePrint = (p, t, { x, y, z, rot, inAt, outAt }) => {
    const din = ease.outCubic(seg(t, inAt, inAt + 0.7));
    const dout = outAt ? ease.inCubic(seg(t, outAt, outAt + 0.5)) : 0;
    p.mesh.visible = din > 0 && dout < 1;
    p.mesh.position.set(x + (1 - din) * 60, -y - (1 - din) * 40, z + (1 - din) * 320 + dout * 700);
    p.mesh.rotation.set(0, 0, rot + (1 - din) * 0.06);
    p.material.opacity = Math.min(din * 1.6, 1) * (1 - dout);
  };

  const cardPose = (t) => {
    const fall = seg(t, ACT.drop, ACT.land);
    const f2 = fall * fall;
    const settle = t > ACT.land ? Math.exp(-(t - ACT.land) * 7) * Math.sin((t - ACT.land) * 30) : 0;
    const e = ease.outCubic(fall);
    return {
      visible: t >= ACT.drop && t < ACT.finale - 0.05,
      x: lerp(-80, 14, e),
      y: lerp(-140, 6, e),
      z: lerp(2400, card.size.t / 2, f2),
      rx: lerp(-0.55, 0, e) + settle * 0.004,
      ry: lerp(0.25, 0, e),
      rz: lerp(0.22, -0.035, e) + settle * 0.01,
    };
  };

  /** Soft contact shadow printed under a resting object (ambient occlusion the shadow map is too coarse for). */
  const contactShadow = (L, x, y, w, h, rot, z, Lgt) => {
    if (z > 1800) return;
    const k = Math.exp(-z / 500);
    const az = (Lgt.az * Math.PI) / 180;
    const el = (Lgt.el * Math.PI) / 180;
    const off = (z + 6) / Math.tan(el);
    const dx = -Math.cos(az) * off;
    const dy = Math.sin(az) * off;
    const c = L.ctx;
    c.save();
    const blur = Math.max(1, (5 + z * 0.12) * L.unit);
    c.filter = `blur(${blur.toFixed(1)}px)`;
    c.globalCompositeOperation = 'multiply';
    for (const [ox, oy, a, grow] of [
      [dx * 0.25, dy * 0.25, 0.42 * k, 2],
      [dx, dy, 0.22 * k, 6 + z * 0.1],
    ]) {
      c.save();
      c.translate(x + ox, y + oy);
      c.rotate(rot);
      c.globalAlpha = a;
      c.fillStyle = '#2a2219';
      c.beginPath();
      c.roundRect(-w / 2 - grow / 2, -h / 2 - grow / 2, w + grow, h + grow, 30);
      c.fill();
      c.restore();
    }
    c.restore();
  };

  function updateObjects(t) {
    // Foil.
    const sep = ringSep(t);
    const lf = lift(t);
    foil.mesh.visible = t >= ACT.lock;
    if (foil.mesh.visible) {
      foil.set(0, 0, R - RING_W / 2 + 0.5, sep, 0.5);
      const s = 1 + 0.06 * (1 - ease.outCubic(seg(t, ACT.lock, ACT.lock + 0.2)));
      foil.mesh.scale.set(s, s, 1);
      foil.material.opacity = seg(t, ACT.lock, ACT.lock + 0.04);
    }

    // Card: drops onto the seal; it is gone (off-camera) before the finale pulls back.
    const cg = card.group;
    const cp = cardPose(t);
    cg.visible = cp.visible;
    if (cg.visible) {
      cg.position.set(cp.x, -cp.y, cp.z);
      cg.rotation.set(cp.rx, cp.ry, cp.rz);
    }

    placePrint(pay, t, { x: 2560, y: 30, z: 26, rot: -0.022, inAt: ACT.pay - 0.4 });
    placePrint(fieldnote, t, { x: 3550, y: 60, z: 22, rot: 0.012, inAt: ACT.apps - 0.5 });
    placePrint(stall, t, { x: 4500, y: 60, z: 30, rot: -0.01, inAt: ACT.apps - 0.35 });
    placePrint(approve, t, { x: 3830, y: 96, z: 110, rot: 0.018, inAt: ACT.approve - 0.15, outAt: ACT.swapA - 0.28 });

    // Sign in through a vesica iris, then sign out when the link is withdrawn.
    const btn = [0.8, 0.426];
    const panel = [0.79, 0.74];
    const wa = ease.inOutCubic(seg(t, ACT.swapA, ACT.swapA + 0.6));
    const wb = ease.inOutCubic(seg(t, ACT.swapB, ACT.swapB + 0.6));
    const ea = ease.inOutCubic(seg(t, ACT.ended, ACT.ended + 0.6));
    const eb = ease.inOutCubic(seg(t, ACT.ended + 0.14, ACT.ended + 0.74));
    if (t < ACT.ended) {
      fieldnote.state(0, 1, wa * 3.0, btn);
      stall.state(0, 1, wb * 3.0, btn);
    } else {
      fieldnote.state(1, 2, ea * 3.0, panel);
      stall.state(1, 2, eb * 3.0, panel);
    }
    for (const p of [pay, fieldnote, stall]) p.uniforms.dim.value = 0;
  }

  // ---------------------------------------------------------------------------
  return {
    frame(t, frameNo) {
      const cam = camera(t);
      const sh = shakeAt(t);
      engine.setCamera({ ...cam, x: cam.x + sh.x * (cam.h / 800), y: cam.y + sh.y * (cam.h / 800) });
      const L = light(t);
      const warm = new THREE.Color('#d8e4ff').lerp(new THREE.Color('#fff0dc'), clamp(L.warm, 0, 1));
      if (L.warm > 1) warm.lerp(new THREE.Color('#ffdcb0'), L.warm - 1);
      engine.setLights({
        azimuth: L.az,
        elevation: L.el,
        key: L.key,
        keyColor: warm.getHex(),
        hemi: L.hemi,
        env: L.env,
        spot: L.spot,
        spotX: t < 4.6 ? lerp(cam.x, L.spotX, seg(t, 2.9, 4.5)) : L.spotX,
        spotY: L.spotY,
        spotAngle: L.spotAngle,
        exposure: Math.max(L.exposure * 1.42, 0.0001),
      });

      const rect = engine.visibleRect();
      engine.press.begin(rect, C.paper);
      for (const [layer, isRelief] of [
        [ink, false],
        [rel, true],
      ]) {
        if (!isRelief) {
          const cp = cardPose(t);
          if (cp.visible) contactShadow(layer, cp.x, cp.y, card.size.w, card.size.h, -cp.rz, cp.z, L);
        }
        drawOpening(layer, isRelief, t);
        layer.reset();
        drawRelays(layer, isRelief, t);
        drawVerify(layer, isRelief, t);
        drawUse(layer, isRelief, t);
        const ad = data.attack;
        attackPanel(layer, isRelief, t, ACT.steal, 2250, 'Steal an address.', [
          { label: 'SIGNED STATEMENT NAMES', value: addrBody, color: C.green },
          { label: 'SIGNATURE RECOVERS', value: ad.attackerAddress.split(':')[1], color: C.ink },
        ], 'signature_invalid', 2);
        attackPanel(layer, isRelief, t, ACT.replay, 3350, 'Replay the proof.', [
          { label: 'PROOF SIGNED FOR', value: shortMid(npub, 22, 8), color: C.violet },
          { label: 'PUBLISHED BY', value: shortMid(ad.attackerNpub, 22, 8), color: C.ink },
        ], 'pubkey_mismatch', 4);
        drawMirror(layer, isRelief, t);
        drawTable(layer, isRelief, t);
        drawLockup(layer, isRelief, t);
        layer.reset();
      }
      engine.press.finish();
      engine.mapPress(rect);

      updateObjects(t);

      const P = post(t);
      engine.render({
        frame: frameNo,
        aperture: P.aperture,
        grain: P.grain,
        vignette: P.vignette,
        fade: clamp(L.exposure * 1.6),
      });
    },
  };
}
