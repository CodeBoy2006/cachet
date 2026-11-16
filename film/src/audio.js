// The score and sound design, rendered offline so it is sample-exact against the picture clock.
import { mulberry32, midi } from './util.js';
import { ACT, BEAT, BAR, S16, DURATION, TYPE, CHECKS, RELAYS, TABLE, ATTACK } from './cues.js';

const CHORD = {
  Dm9: [50, 57, 64, 65],
  Dmaj9: [50, 57, 61, 64, 66],
  Bm9: [47, 54, 57, 61, 62],
  Gmaj9: [43, 50, 54, 57, 59],
  A69: [45, 52, 57, 59, 61, 64],
  Gm6: [43, 50, 52, 58, 62],
  Bbmaj7: [46, 53, 57, 62],
  Gm9: [43, 50, 57, 58, 62],
  A7sus: [45, 52, 57, 62, 67],
  A7: [45, 52, 55, 61, 64],
  D69: [50, 57, 59, 64, 66, 69],
};

export async function renderScore({ sampleRate = 48000, typed = 54 } = {}) {
  const length = Math.ceil(DURATION * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const rnd = mulberry32(20261122);

  // ---------- buses ----------
  const gain = (v = 1) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const master = gain(0.85);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.012;
  comp.release.value = 0.3;
  master.connect(comp).connect(ctx.destination);

  const musicTone = ctx.createBiquadFilter();
  musicTone.type = 'lowpass';
  musicTone.frequency.value = 18000;
  musicTone.Q.value = 0.5;
  const music = gain(1);
  music.connect(musicTone).connect(master);
  const sfx = gain(1);
  sfx.connect(master);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 3.6, 0.018, rnd);
  const verbIn = gain(1);
  const verbOut = gain(0.55);
  verbIn.connect(verb).connect(verbOut).connect(master);

  // Ping-pong delay at a dotted eighth.
  const dIn = gain(1);
  const dL = ctx.createDelay(2);
  const dR = ctx.createDelay(2);
  dL.delayTime.value = BEAT * 0.75;
  dR.delayTime.value = BEAT * 0.75;
  const fb = gain(0.34);
  const dTone = ctx.createBiquadFilter();
  dTone.type = 'lowpass';
  dTone.frequency.value = 3200;
  const merger = ctx.createChannelMerger(2);
  dIn.connect(dL);
  dL.connect(dR);
  dR.connect(dTone).connect(fb).connect(dL);
  dL.connect(merger, 0, 0);
  dR.connect(merger, 0, 1);
  const dOut = gain(0.3);
  merger.connect(dOut).connect(master);
  dOut.connect(verbIn);

  // ---------- sources ----------
  const noiseBuf = (() => {
    const b = ctx.createBuffer(2, sampleRate * 3, sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    }
    return b;
  })();
  const noise = (t, dur) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(t, rnd() * 2.5);
    s.stop(t + dur + 0.05);
    return s;
  };
  const osc = (type, f, t, dur) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  };
  const filter = (type, f, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const pan = (p) => {
    const n = ctx.createStereoPanner();
    n.pan.value = p;
    return n;
  };
  /** Routes a voice into a bus plus sends; returns the voice input node. */
  const out = (bus, p = 0, rev = 0, del = 0) => {
    const pn = pan(p);
    pn.connect(bus);
    if (rev) pn.connect(gain(rev)).connect(verbIn);
    if (del) pn.connect(gain(del)).connect(dIn);
    return pn;
  };
  const perc = (g, t, peak, tc, a = 0.002) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0, t + a, tc);
  };

  // ---------- instruments ----------
  const bell = (t, n, { vel = 0.2, dur = 3, p = 0, rev = 0.45, del = 0.15, ratio = 3.5, index = 1.6, bus = music } = {}) => {
    const f = typeof n === 'number' && n < 200 ? midi(n) : n;
    const car = osc('sine', f, t, dur);
    const mod = osc('sine', f * ratio, t, dur);
    const mg = gain(0);
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.setTargetAtTime(f * index * 0.04, t, dur * 0.12);
    mod.connect(mg).connect(car.frequency);
    const amp = gain(0);
    perc(amp, t, vel, dur / 4.5, 0.003);
    const dest = out(bus, p, rev, del);
    car.connect(amp).connect(dest);
    // Octave partial for air.
    const hi = osc('sine', f * 2.003, t, dur * 0.5);
    const ha = gain(0);
    perc(ha, t, vel * 0.18, dur / 12, 0.002);
    hi.connect(ha).connect(dest);
  };

  const ep = (t, n, { vel = 0.06, dur = 1.2, p = 0, rev = 0.25, del = 0.2, bus = music } = {}) => {
    const f = midi(n);
    const car = osc('sine', f, t, dur);
    const mod = osc('sine', f, t, dur);
    const mg = gain(0);
    mg.gain.setValueAtTime(f * 1.9, t);
    mg.gain.setTargetAtTime(f * 0.15, t, 0.07);
    mod.connect(mg).connect(car.frequency);
    const tine = osc('sine', f * 7.02, t, 0.3);
    const tg = gain(0);
    perc(tg, t, vel * 0.08, 0.025);
    const amp = gain(0);
    perc(amp, t, vel, dur / 3.2, 0.004);
    const lp = filter('lowpass', 2400, 0.5);
    const dest = out(bus, p, rev, del);
    car.connect(amp).connect(lp).connect(dest);
    tine.connect(tg).connect(dest);
  };

  const pad = (t0, t1, notes, { level = 0.05, cut0 = 700, cut1 = 1600, attack = 1.4, release = 1.8, rev = 0.5, bus = music, q = 0.6 } = {}) => {
    const dur = t1 - t0 + release;
    const lp = filter('lowpass', cut0, q);
    lp.frequency.setValueAtTime(cut0, t0);
    lp.frequency.linearRampToValueAtTime(cut1, t1);
    const amp = gain(0);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(level, t0 + attack);
    amp.gain.setValueAtTime(level, t1);
    amp.gain.setTargetAtTime(0, t1, release / 4);
    lp.connect(amp).connect(out(bus, 0, rev));
    notes.forEach((n, i) => {
      const f = midi(n);
      const p = pan(((i % 2) * 2 - 1) * (0.25 + 0.1 * i) * 0.8);
      p.connect(lp);
      for (const det of [-7, 6]) {
        const o = osc('sawtooth', f, t0, dur);
        o.detune.value = det + (rnd() - 0.5) * 3;
        const g = gain(0.16 / notes.length ** 0.5);
        o.connect(g).connect(p);
      }
      const s = osc('sine', f, t0, dur);
      s.connect(gain(0.22 / notes.length ** 0.5)).connect(p);
    });
  };

  const sub = (t, dur, n, { vel = 0.25, attack = 0.02, bus = music } = {}) => {
    const o = osc('sine', midi(n), t, dur);
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + attack);
    g.gain.setTargetAtTime(0, t + dur * 0.4, dur / 4);
    o.connect(g).connect(bus);
  };

  const bass = (t, n, { vel = 0.16, dur = BEAT * 0.9 } = {}) => {
    const f = midi(n);
    const o = osc('triangle', f, t, dur);
    const s = osc('sine', f, t, dur);
    const lp = filter('lowpass', 420, 0.8);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.setTargetAtTime(300, t, 0.06);
    const g = gain(0);
    perc(g, t, vel, dur / 3, 0.006);
    o.connect(lp);
    s.connect(gain(0.8)).connect(lp);
    lp.connect(g).connect(music);
  };

  const kick = (t, vel = 0.5, bus = music) => {
    const o = osc('sine', 120, t, 0.6);
    o.frequency.setValueAtTime(128, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = gain(0);
    perc(g, t, vel, 0.13, 0.002);
    o.connect(g).connect(bus);
    const n = noise(t, 0.03);
    const hp = filter('highpass', 2500);
    const ng = gain(0);
    perc(ng, t, vel * 0.08, 0.004, 0.0005);
    n.connect(hp).connect(ng).connect(bus);
  };

  const hat = (t, vel = 0.03, tc = 0.014, p = 0.2) => {
    const n = noise(t, tc * 6);
    const hp = filter('highpass', 7600, 0.7);
    const g = gain(0);
    perc(g, t, vel, tc, 0.0008);
    n.connect(hp).connect(g).connect(out(music, p, 0.08));
  };

  const snap = (t, vel = 0.05) => {
    const n = noise(t, 0.12);
    const bp = filter('bandpass', 1700, 1.1);
    const g = gain(0);
    perc(g, t, vel, 0.035, 0.001);
    n.connect(bp).connect(g).connect(out(music, -0.1, 0.25));
  };

  const tick = (t, { vel = 0.05, f = 2600, p = 0, q = 6 } = {}) => {
    const n = noise(t, 0.03);
    const bp = filter('bandpass', f, q);
    const g = gain(0);
    perc(g, t, vel, 0.006, 0.0006);
    n.connect(bp).connect(g).connect(out(sfx, p, 0.06));
  };

  const tock = (t, { vel = 0.18, f = 820, p = 0 } = {}) => {
    const o = osc('sine', f, t, 0.2);
    o.frequency.setValueAtTime(f * 1.08, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
    const g = gain(0);
    perc(g, t, vel, 0.035, 0.001);
    o.connect(g).connect(out(sfx, p, 0.3));
    tick(t, { vel: vel * 0.4, f: 3400, p });
  };

  const whoosh = (t, dur, { vel = 0.06, f0 = 300, f1 = 2400, p0 = -0.3, p1 = 0.3, q = 0.9 } = {}) => {
    const n = noise(t, dur);
    const bp = filter('bandpass', f0, q);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.62);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const pn = pan(p0);
    pn.pan.setValueAtTime(p0, t);
    pn.pan.linearRampToValueAtTime(p1, t + dur);
    n.connect(bp).connect(g).connect(pn).connect(sfx);
    pn.connect(gain(0.3)).connect(verbIn);
  };

  const scratch = (t, dur, { vel = 0.05, p = 0 } = {}) => {
    const n = noise(t, dur);
    const bp = filter('bandpass', 4300, 1.4);
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    for (let x = 0; x < dur; x += 0.018) g.gain.setValueAtTime(vel * (0.35 + rnd() * 0.65), t + x);
    g.gain.setValueAtTime(0, t + dur);
    const lp = filter('lowpass', 7000);
    n.connect(bp).connect(lp).connect(g).connect(out(sfx, p, 0.12));
  };

  const stamp = (t, { vel = 0.4, f = 150, p = 0, rev = 0.18 } = {}) => {
    const n = noise(t, 0.2);
    const lp = filter('lowpass', 1300, 0.8);
    const g = gain(0);
    perc(g, t, vel * 0.55, 0.028, 0.001);
    n.connect(lp).connect(g).connect(out(sfx, p, rev));
    const o = osc('sine', f, t, 0.3);
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const og = gain(0);
    perc(og, t, vel, 0.06, 0.001);
    o.connect(og).connect(out(sfx, p, rev));
  };

  const clack = (t, vel = 0.3) => {
    for (const [dt, v] of [
      [0, 1],
      [0.034, 0.45],
      [0.071, 0.18],
    ]) {
      const tt = t + dt;
      const n = noise(tt, 0.08);
      const bp = filter('bandpass', 3100, 1.6);
      const g = gain(0);
      perc(g, tt, vel * v * 0.5, 0.012, 0.0006);
      n.connect(bp).connect(g).connect(out(sfx, 0.05, 0.2));
      const f = 1650;
      const car = osc('sine', f, tt, 0.35);
      const mod = osc('sine', f * 1.47, tt, 0.35);
      const mg = gain(f * 3);
      mg.gain.setTargetAtTime(0, tt, 0.04);
      mod.connect(mg).connect(car.frequency);
      const cg = gain(0);
      perc(cg, tt, vel * v * 0.09, 0.05, 0.0006);
      car.connect(cg).connect(out(sfx, 0.05, 0.3));
    }
    kick(t, vel * 0.5, sfx);
  };

  const thunk = (t, vel = 1) => {
    const o = osc('sine', 70, t, 3);
    o.frequency.setValueAtTime(72, t);
    o.frequency.exponentialRampToValueAtTime(36.7, t + 0.35);
    const g = gain(0);
    perc(g, t, 0.36 * vel, 0.5, 0.003);
    o.connect(g).connect(out(sfx, 0, 0.25));
    // Body an octave up so small speakers feel the impact too.
    const body = osc('sine', 110, t, 1.2);
    body.frequency.setValueAtTime(140, t);
    body.frequency.exponentialRampToValueAtTime(73.4, t + 0.18);
    const bg = gain(0);
    perc(bg, t, 0.22 * vel, 0.22, 0.002);
    body.connect(bg).connect(out(sfx, 0, 0.35));
    kick(t, 0.75 * vel, sfx);
    const n = noise(t, 0.6);
    const lp = filter('lowpass', 520, 0.6);
    const ng = gain(0);
    perc(ng, t, 0.22 * vel, 0.09, 0.001);
    n.connect(lp).connect(ng).connect(out(sfx, 0, 0.6));
    const press = noise(t, 0.2);
    const bp = filter('bandpass', 1400, 0.8);
    const pg = gain(0);
    perc(pg, t, 0.06 * vel, 0.03, 0.001);
    press.connect(bp).connect(pg).connect(out(sfx, 0, 0.4));
    bell(t, 38, { vel: 0.18 * vel, dur: 5, ratio: 1, index: 0.8, rev: 0.6, del: 0, bus: sfx });
  };

  const riser = (t0, t1, { vel = 0.07 } = {}) => {
    const dur = t1 - t0;
    const n = noise(t0, dur);
    const hp = filter('bandpass', 300, 0.7);
    hp.frequency.setValueAtTime(300, t0);
    hp.frequency.exponentialRampToValueAtTime(5200, t1);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vel, t1 - 0.02);
    g.gain.linearRampToValueAtTime(0, t1);
    n.connect(hp).connect(g).connect(out(sfx, 0, 0.35));
  };

  /** Reverse swell: rises into `t`. */
  const swell = (t, dur, notes, { vel = 0.05 } = {}) => {
    const t0 = t - dur;
    const lp = filter('lowpass', 300, 0.8);
    lp.frequency.setValueAtTime(300, t0);
    lp.frequency.exponentialRampToValueAtTime(3200, t);
    const g = gain(0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vel, t - 0.01);
    g.gain.linearRampToValueAtTime(0, t + 0.04);
    lp.connect(g).connect(out(music, 0, 0.5));
    for (const n of notes) {
      const o = osc('sawtooth', midi(n), t0, dur);
      o.connect(gain(0.3)).connect(lp);
    }
  };

  // ======================================================================
  // I. The string (0 – 8.75)
  // ======================================================================
  // Room tone and drone.
  {
    const n = noise(0, ACT.lock);
    const lp = filter('lowpass', 420, 0.4);
    const g = gain(0);
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.022, 1.5);
    g.gain.setValueAtTime(0.022, ACT.breath - 0.4);
    g.gain.linearRampToValueAtTime(0, ACT.breath);
    n.connect(lp).connect(g).connect(sfx);
  }
  {
    const t0 = 0.05;
    const t1 = ACT.breath;
    for (const [n, v] of [
      [38, 0.06],
      [45, 0.025],
      [50, 0.012],
      [26, 0.022],
    ]) {
      const o = osc('sine', midi(n), t0, t1 - t0 + 1);
      const g = gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v, t0 + 2.8);
      g.gain.setValueAtTime(v, t1 - 0.5);
      g.gain.linearRampToValueAtTime(0, t1);
      o.connect(g).connect(music);
    }
  }
  // The slit of light switching on.
  stamp(0.12, { vel: 0.09, f: 95, rev: 0.5 });
  // Typed address.
  for (let i = 0; i < typed; i++) {
    const t = TYPE.start + i * TYPE.step;
    tick(t, { vel: 0.035 + rnd() * 0.025, f: 2100 + rnd() * 1600, p: -0.5 + (i / typed) * 1.0, q: 5 });
  }
  whoosh(2.75, 1.7, { vel: 0.045, f0: 1800, f1: 260, p0: 0.2, p1: -0.1 });
  bell(3.55, 74, { vel: 0.12, dur: 4, p: 0.1, rev: 0.5, del: 0.3 });
  // Heartbeat sub every half note.
  for (let t = 2.5; t < ACT.keys; t += BEAT * 2) kick(t, 0.13);
  // Claimants.
  [0, 1, 2].forEach((i) => {
    const t = ACT.claim + 0.15 + i * 0.26;
    tock(t, { vel: 0.07, f: 640 + i * 90, p: (i - 1) * 0.6 });
    scratch(t + 0.08, 0.34, { vel: 0.035, p: (i - 1) * 0.6 });
  });
  bell(5.3, 77, { vel: 0.1, dur: 4, p: -0.15, rev: 0.5, del: 0.3 });
  // Curl into rings.
  swell(ACT.keys, 1.9, [50, 57, 62], { vel: 0.035 });
  whoosh(ACT.curl, 1.6, { vel: 0.04, f0: 500, f1: 1800, p0: 0.5, p1: -0.5 });

  // ======================================================================
  // II. Two keys, one statement (8.75 – 20)
  // ======================================================================
  const tones = (() => {
    const make = (f0, p) => {
      const t0 = ACT.keys;
      const t1 = ACT.lock + 4.5;
      const tri = osc('triangle', f0, t0, t1 - t0);
      const sin = osc('sine', f0, t0, t1 - t0);
      const lp = filter('lowpass', 1100, 0.5);
      const g = gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 1.2);
      g.gain.linearRampToValueAtTime(0.085, ACT.breath);
      g.gain.setValueAtTime(0.085, ACT.lock);
      g.gain.linearRampToValueAtTime(0.11, ACT.lock + 0.02);
      g.gain.setTargetAtTime(0, ACT.lock + 0.3, 1.1);
      tri.connect(gain(0.6)).connect(lp);
      sin.connect(lp);
      lp.connect(g).connect(out(music, p, 0.35));
      return [tri.frequency, sin.frequency];
    };
    return { nostr: make(midi(50), -0.45), bch: make(150.2, 0.45) };
  })();
  for (const fr of tones.bch) {
    fr.setValueAtTime(150.2, ACT.converge);
    fr.linearRampToValueAtTime(147.6, ACT.breath);
    fr.setValueAtTime(147.6, ACT.lock - 0.01);
    fr.linearRampToValueAtTime(midi(50), ACT.lock);
  }
  for (const fr of tones.nostr) {
    fr.setValueAtTime(midi(50), ACT.breath);
    fr.exponentialRampToValueAtTime(midi(57), ACT.lock - 0.02);
  }
  pad(ACT.statement, ACT.breath, CHORD.Dm9, { level: 0.04, cut0: 450, cut1: 1500, attack: 2 });
  // Clockwork eighths.
  {
    const pat = [62, 69, 65, 69];
    let i = 0;
    for (let t = ACT.statement; t < ACT.breath - 0.01; t += BEAT / 2, i++) {
      const grow = (t - ACT.statement) / (ACT.breath - ACT.statement);
      ep(t, pat[i % 4], { vel: 0.022 + grow * 0.04, dur: 0.9, p: i % 2 ? 0.35 : -0.35, del: 0.12 });
    }
  }
  whoosh(ACT.statement - 0.2, 1.1, { vel: 0.035, f0: 700, f1: 2600, p0: 0, p1: 0 });
  tock(ACT.signBch, { vel: 0.17, f: 760, p: 0.4 });
  bell(ACT.signBch, 76, { vel: 0.11, dur: 3, p: 0.45 });
  for (let i = 0; i < 20; i++) tick(ACT.signBch + 0.22 + i * 0.034, { vel: 0.025, f: 2900 + rnd() * 900, p: 0.2 });
  tock(ACT.signNostr, { vel: 0.17, f: 900, p: -0.4 });
  bell(ACT.signNostr, 81, { vel: 0.11, dur: 3, p: -0.45 });
  for (let i = 0; i < 20; i++) tick(ACT.signNostr + 0.22 + i * 0.034, { vel: 0.025, f: 2900 + rnd() * 900, p: -0.2 });
  // Statement collapses to its hash.
  whoosh(ACT.converge + 0.35, 0.7, { vel: 0.05, f0: 3200, f1: 500, p0: 0, p1: 0, q: 1.4 });
  riser(ACT.converge + 0.6, ACT.breath, { vel: 0.05 });
  for (let t = ACT.converge + BAR / 2; t < ACT.breath - 0.05; t += BEAT) {
    const k = (t - ACT.converge) / (ACT.breath - ACT.converge);
    kick(t, 0.12 + k * 0.28);
  }

  // ======================================================================
  // Lock (20.0)
  // ======================================================================
  thunk(ACT.lock);
  bell(ACT.lock, 74, { vel: 0.16, dur: 6, p: -0.3, rev: 0.6, del: 0.2 });
  bell(ACT.lock, 81, { vel: 0.14, dur: 6, p: 0.3, rev: 0.6, del: 0.2 });
  bell(ACT.lock + 0.32, 86, { vel: 0.06, dur: 4, p: 0, rev: 0.7, del: 0.3 });
  pad(ACT.lock, ACT.lock + BAR - 0.2, [38, 50, 57, 61, 64, 66], { level: 0.075, cut0: 3800, cut1: 1800, attack: 0.04, release: 2.2 });
  sub(ACT.lock, 3.5, 26, { vel: 0.08 });
  sub(ACT.lock, 3.0, 38, { vel: 0.06 });

  // ======================================================================
  // III. Relays and verification (20 – 30)
  // ======================================================================
  const prog1 = [
    [ACT.lock + BAR, CHORD.Bm9, 35],
    [ACT.lock + BAR * 2, CHORD.Gmaj9, 43],
    [ACT.lock + BAR * 3, CHORD.A69, 45],
  ];
  for (const [t, c] of prog1) pad(t, t + BAR, c, { level: 0.05, cut0: 1400, cut1: 2000, attack: 0.5, release: 1.2 });
  // Card drop.
  whoosh(ACT.drop - 0.25, 0.85, { vel: 0.05, f0: 2400, f1: 380, p0: 0.1, p1: 0 });
  clack(ACT.land, 0.32);
  // Relay pings.
  [81, 83, 86, 88, 90, 93].forEach((n, i) => {
    const t = RELAYS.start + i * RELAYS.step;
    bell(t, n, { vel: 0.05, dur: 1.8, p: -0.6 + i * 0.24, rev: 0.4, del: 0.25, ratio: 2.01, index: 1 });
  });
  // Checks on 16ths.
  [74, 76, 78, 81, 83, 86, 88, 90, 93].forEach((n, i) => {
    const t = CHECKS.start + i * CHECKS.step;
    tick(t, { vel: 0.05, f: 3000, p: 0.3, q: 4 });
    bell(t, n, { vel: 0.035, dur: 1.2, p: 0.3, rev: 0.25, del: 0.1, ratio: 2.01, index: 0.7 });
  });
  {
    const qed = CHECKS.start + 9 * CHECKS.step + S16;
    tock(qed, { vel: 0.12, f: 520 });
    bell(qed, 62, { vel: 0.08, dur: 3, p: 0, ratio: 1, index: 0.6 });
    bell(qed, 69, { vel: 0.06, dur: 3, p: 0.2, ratio: 1, index: 0.6 });
  }

  // Groove from the card landing to the attacks.
  const arp = (t0, t1, chord, { vel = 0.045 } = {}) => {
    const tones = chord.filter((n) => n >= 54).map((n) => n + 12);
    const order = [0, 2, 1, 3, 2, 4, 3, 1];
    let i = 0;
    for (let t = t0; t < t1 - 0.01; t += S16, i++) {
      const n = tones[order[i % order.length] % tones.length];
      const acc = i % 4 === 0 ? 1 : 0.62;
      ep(t, n, { vel: vel * acc * (0.85 + rnd() * 0.3), dur: 0.7, p: i % 2 ? 0.45 : -0.45, del: 0.18, rev: 0.2 });
    }
  };
  const groove = [
    [ACT.lock + BAR, CHORD.Bm9, 35],
    [ACT.lock + BAR * 2, CHORD.Gmaj9, 43],
    [ACT.lock + BAR * 3, CHORD.A69, 45],
    [ACT.pay, CHORD.Dmaj9, 38],
    [ACT.pay + BAR, CHORD.Bm9, 35],
    [ACT.pay + BAR * 2, CHORD.Gmaj9, 43],
    [ACT.pay + BAR * 3, CHORD.A69, 45],
    [ACT.pay + BAR * 4, CHORD.Gm6, 43],
  ];
  for (const [t, c, root] of groove) {
    const start = Math.max(t, ACT.land + S16);
    arp(start, t + BAR, c, { vel: t >= ACT.pay ? 0.05 : 0.046 });
    if (t >= ACT.pay) pad(t, t + BAR, c, { level: 0.036, cut0: 1500, cut1: 2100, attack: 0.5, release: 1.2 });
    // Bass on 1 and the and-of-2.
    if (t >= ACT.lock + BAR) {
      bass(t, root, { vel: 0.15 });
      bass(t + BEAT * 1.5, root + 12, { vel: 0.08, dur: BEAT * 0.5 });
      bass(t + BEAT * 2, root, { vel: 0.11 });
      bass(t + BEAT * 3.5, root + 7, { vel: 0.07, dur: BEAT * 0.4 });
    }
    for (let b = 0; b < 4; b++) {
      const tb = t + b * BEAT;
      if (t >= ACT.verify - 0.4 && (b === 0 || b === 2)) kick(tb, t >= ACT.pay ? 0.42 : 0.3);
      if (t >= ACT.pay && (b === 1 || b === 3)) snap(tb, 0.045);
      if (t >= ACT.verify + BAR) hat(tb + BEAT / 2, 0.022);
      if (t >= ACT.pay) {
        hat(tb + S16, 0.008, 0.01, -0.3);
        hat(tb + S16 * 3, 0.01, 0.01, 0.3);
      }
    }
  }

  // ======================================================================
  // IV. In use (30 – 42.5)
  // ======================================================================
  whoosh(ACT.pay - 0.5, 1.1, { vel: 0.045, f0: 400, f1: 2200, p0: -0.4, p1: 0.4 });
  bell(ACT.pay + 1.25, 81, { vel: 0.06, dur: 2.2, p: 0.2, ratio: 2.01, index: 0.9 });
  bell(ACT.pay + 1.25 + S16 * 2, 86, { vel: 0.05, dur: 2.2, p: 0.3, ratio: 2.01, index: 0.9 });
  whoosh(ACT.apps - 0.5, 1.1, { vel: 0.045, f0: 500, f1: 2400, p0: 0.4, p1: -0.4 });
  tick(ACT.approve, { vel: 0.07, f: 2000, q: 3 });
  for (const [t, a, b, p] of [
    [ACT.swapA, 86, 93, -0.35],
    [ACT.swapB, 88, 95, 0.35],
  ]) {
    tick(t - 0.12, { vel: 0.08, f: 1800, q: 3, p });
    bell(t, a, { vel: 0.07, dur: 2, p, ratio: 2.01, index: 0.8 });
    bell(t + S16, b, { vel: 0.05, dur: 2, p, ratio: 2.01, index: 0.8 });
  }
  whoosh(ACT.withdraw - 0.4, 1.0, { vel: 0.04, f0: 300, f1: 1500, p0: 0, p1: 0 });
  stamp(ACT.stamp, { vel: 0.5, f: 120, rev: 0.3 });
  for (const [dt, p] of [
    [0, -0.4],
    [0.09, 0.4],
  ]) {
    bell(ACT.ended + dt, 81, { vel: 0.05, dur: 1.4, p, ratio: 2.01, index: 0.7 });
    bell(ACT.ended + dt + S16 * 2, 76, { vel: 0.045, dur: 1.8, p, ratio: 2.01, index: 0.7 });
  }
  // Close the music down into the cold light.
  musicTone.frequency.setValueAtTime(18000, ACT.attacks - 1.0);
  musicTone.frequency.exponentialRampToValueAtTime(700, ACT.attacks);
  musicTone.frequency.setValueAtTime(700, ACT.attacks);
  musicTone.frequency.exponentialRampToValueAtTime(2600, ACT.attacks + BAR);
  musicTone.frequency.setValueAtTime(2600, ACT.finale - 0.6);
  musicTone.frequency.exponentialRampToValueAtTime(18000, ACT.finale);
  swell(ACT.attacks, 1.2, [50, 53, 57], { vel: 0.03 });

  // ======================================================================
  // V. Attacks (42.5 – 52.5)
  // ======================================================================
  const prog2 = [
    [ACT.attacks, CHORD.Dm9, 38],
    [ACT.attacks + BAR, CHORD.Bbmaj7, 34],
    [ACT.attacks + BAR * 2, CHORD.Gm9, 31],
    [ACT.attacks + BAR * 3, CHORD.A7sus, 33],
  ];
  for (const [t, c, root] of prog2) {
    pad(t, t + BAR, c, { level: 0.04, cut0: 900, cut1: 1300, attack: 0.4, release: 1.0 });
    for (let i = 0; i < 8; i++) {
      const tt = t + i * (BEAT / 2);
      bass(tt, root + (i % 4 === 3 ? 12 : 0), { vel: i % 2 ? 0.07 : 0.11, dur: BEAT * 0.4 });
      if (i % 2 === 0) hat(tt + BEAT / 4, 0.012, 0.008);
    }
    kick(t, 0.32);
    kick(t + BEAT * 2, 0.24);
  }
  [ACT.steal, ACT.replay, ACT.mirror].forEach((a, i) => {
    whoosh(a + ATTACK.caption - 0.25, 0.7, { vel: 0.03, f0: 600, f1: 1800, p0: -0.2, p1: 0.2 });
    scratch(a + ATTACK.mark, 0.42, { vel: 0.06, p: 0.1 });
    stamp(a + ATTACK.code, { vel: 0.42, f: 140, p: 0.1 });
    bell(a + ATTACK.code, [63, 64, 61][i], { vel: 0.05, dur: 2, p: -0.2, ratio: 1.41, index: 1.2 });
  });
  for (let i = 0; i < 12; i++) {
    const t = TABLE.start + i * TABLE.step;
    if (i === 0) bell(t, 86, { vel: 0.08, dur: 2.5, p: 0, ratio: 2.01, index: 0.8 });
    else stamp(t, { vel: 0.2 + i * 0.012, f: 110 + (i % 3) * 18, p: (i % 2 ? 0.25 : -0.25), rev: 0.1 });
  }
  pad(ACT.table + BAR / 2, ACT.finale, CHORD.A7, { level: 0.03, cut0: 1200, cut1: 2600, attack: 0.3, release: 0.4 });
  riser(ACT.finale - 1.2, ACT.finale, { vel: 0.045 });

  // ======================================================================
  // VI. Finale (52.5 – 62)
  // ======================================================================
  pad(ACT.finale, ACT.dark, [38, ...CHORD.Dmaj9, 69], { level: 0.07, cut0: 3200, cut1: 1600, attack: 0.08, release: 3.2 });
  sub(ACT.finale, 6, 26, { vel: 0.07, attack: 0.05 });
  sub(ACT.finale, 5, 38, { vel: 0.05, attack: 0.05 });
  kick(ACT.finale, 0.4);
  whoosh(ACT.finale + 0.1, 2.4, { vel: 0.04, f0: 2600, f1: 300, p0: 0.3, p1: -0.3 });
  [
    [0.05, 74],
    [0.66, 81],
    [1.27, 88],
  ].forEach(([dt, n]) => bell(ACT.finale + dt, n, { vel: 0.09, dur: 4, p: (n - 81) / 20, rev: 0.6, del: 0.3 }));
  thunk(ACT.lockup, 0.45);
  bell(ACT.lockup, 74, { vel: 0.13, dur: 7, p: -0.3, rev: 0.7, del: 0.25 });
  bell(ACT.lockup, 81, { vel: 0.12, dur: 7, p: 0.3, rev: 0.7, del: 0.25 });
  pad(ACT.lockup, ACT.dark + 0.8, [38, ...CHORD.D69], { level: 0.05, cut0: 2600, cut1: 900, attack: 0.3, release: 3.5 });
  [81, 78, 76, 74].forEach((n, i) => ep(ACT.lockup + 1.25 + i * BEAT * 1.0, n, { vel: 0.05, dur: 2.2, p: 0.3 - i * 0.2, del: 0.3, rev: 0.5 }));
  bell(ACT.dark + 0.25, 62, { vel: 0.05, dur: 5, p: -0.2, rev: 0.8, ratio: 1, index: 0.5 });
  bell(ACT.dark + 0.25, 69, { vel: 0.045, dur: 5, p: 0.2, rev: 0.8, ratio: 1, index: 0.5 });
  master.gain.setValueAtTime(0.85, DURATION - 3.2);
  master.gain.linearRampToValueAtTime(0, DURATION - 0.2);

  const buffer = await ctx.startRendering();
  limit(buffer, 4.5, -1.0);
  return buffer;
}

/** Stereo plate-ish impulse: early reflections, then decorrelated decaying noise that darkens. */
function impulse(ctx, seconds, predelay, rnd) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    const pre = Math.floor(predelay * sr);
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / sr;
      const env = Math.exp(-x * (6.9 / seconds)) * (1 - Math.exp(-x * 60));
      const k = 0.55 - 0.45 * Math.min(1, x / seconds);
      lp += k * ((rnd() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    for (let e = 0; e < 14; e++) {
      const i = pre + Math.floor((0.004 + rnd() * 0.07) * sr);
      if (i < len) d[i] += (rnd() * 2 - 1) * 0.5 * (1 - e / 14);
    }
  }
  return buf;
}

/** Look-ahead peak limiter: +gainDb of make-up, transparent below the ceiling. */
function limit(buffer, gainDb, ceilingDb) {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const n = L.length;
  const pre = 10 ** (gainDb / 20);
  const ceil = 10 ** (ceilingDb / 20);
  const look = Math.round(0.005 * sr);
  const rel = Math.exp(-1 / (0.15 * sr));
  // Sliding maximum of |x| over the next `look` samples (monotonic deque).
  const peak = new Float32Array(n);
  const q = new Int32Array(n + look + 1);
  let head = 0;
  let tail = 0;
  const amp = (i) => Math.max(Math.abs(L[i]), Math.abs(R[i])) * pre;
  for (let i = n - 1; i >= 0; i--) {
    const a = amp(i);
    while (tail > head && amp(q[tail - 1]) <= a) tail--;
    q[tail++] = i;
    while (q[head] > i + look) head++;
    peak[i] = amp(q[head]);
  }
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = peak[i] > ceil ? ceil / peak[i] : 1;
    g = target < g ? target : target + (g - target) * rel;
    const k = pre * g;
    L[i] *= k;
    R[i] *= k;
  }
}

function normalize(buffer, target) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak <= 0) return;
  const k = target / peak;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

/** 16-bit PCM WAV for muxing with a frame render later. */
export function toWav(buffer) {
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new Blob([out], { type: 'audio/wav' });
}
