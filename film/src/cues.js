// One clock for picture and sound. 96 BPM: 1 beat = 0.625 s, 1 bar = 2.5 s, 24 bars ≈ 60 s.
export const BPM = 96;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const S16 = BEAT / 4;
export const DURATION = 62;
export const bar = (n, beat = 0) => (n - 1) * BAR + beat * BEAT;

export const ACT = {
  open: 0,
  claim: 4.6,
  curl: 6.9,
  keys: 8.75,
  statement: 11.25,
  signBch: 13.75,
  signNostr: 15.0,
  converge: 16.25,
  breath: 19.55,
  lock: 20.0,
  drop: 22.0,
  land: 22.62,
  relays: 23.2,
  verify: 25.4,
  pay: 30.0,
  apps: 33.75,
  approve: 34.5,
  swapA: 35.4,
  swapB: 36.65,
  withdraw: 38.75,
  stamp: 39.7,
  ended: 40.3,
  attacks: 42.5,
  steal: 42.5,
  replay: 45.0,
  mirror: 47.5,
  table: 50.0,
  finale: 52.5,
  lockup: 55.0,
  dark: 58.6,
};

// Characters of the address appear one per typed tick during the macro opening.
export const TYPE = { start: 0.55, step: 0.043 };

// Verification ticks on 16th notes.
export const CHECKS = { start: 26.25, step: S16 };
export const RELAYS = { start: 23.55, step: 0.19 };
// The Lab table stamps on 16ths.
export const TABLE = { start: 50.55, step: S16 };
// Attack beats: caption, red mark, failure stamp (relative to each attack start).
export const ATTACK = { caption: 0.15, mark: 1.0, code: 1.55 };
