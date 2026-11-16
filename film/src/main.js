import { Engine } from './engine.js';
import { createStory } from './story.js';
import { renderScore, toWav } from './audio.js';
import { ACT, BAR, DURATION } from './cues.js';
import data from './data.json';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1920);
const H = Number(params.get('h') ?? 1080);
const FPS = 24; // grain cadence

const $ = (id) => document.getElementById(id);
const canvas = $('film');
const ui = {
  toggle: $('toggle'),
  bar: $('bar'),
  fill: $('fill'),
  time: $('time'),
  mute: $('mute'),
  wav: $('wav'),
  full: $('full'),
  overlay: $('playOverlay'),
  big: $('bigPlay'),
  status: $('status'),
  debug: $('debug'),
};

const ICON = {
  play: '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  pause: '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>',
  sound: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8"/></svg>',
  muted: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 6l3.5 3.5M14.5 6 11 9.5"/></svg>',
};

const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function fit() {
  const k = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = `${Math.floor(W * k)}px`;
  canvas.style.height = `${Math.floor(H * k)}px`;
}

async function loadFonts() {
  const faces = [
    ['Film Serif', '/assets/fonts/serif.woff2', '200 900'],
    ['Film Serif Italic', '/assets/fonts/serif-italic.woff2', '200 900'],
    ['Film Sans', '/assets/fonts/geist.woff2', '100 900'],
    ['Film Mono', '/assets/fonts/geist-mono.woff2', '100 900'],
  ];
  await Promise.all(
    faces.map(async ([family, url, weight]) => {
      const f = new FontFace(family, `url(${url})`, { weight });
      document.fonts.add(await f.load());
    }),
  );
}

async function loadImages(names) {
  const out = {};
  await Promise.all(
    names.map(async (n) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`Could not load ${n}.png`));
        img.src = `/assets/ui/${n}.png`;
      });
      out[n] = img;
    }),
  );
  return out;
}

async function boot() {
  fit();
  addEventListener('resize', fit);
  canvas.width = W;
  canvas.height = H;

  await loadFonts();
  const images = await loadImages(['pay', 'approve', 'fieldnote-out', 'fieldnote-in', 'fieldnote-ended', 'stall-out', 'stall-in', 'stall-ended']);
  const engine = new Engine(canvas, { width: W, height: H });
  const story = createStory({ engine, data, images });
  // Warm-up: compile every material and upload every texture before playback can stutter on them.
  for (const wt of [0.5, 3.9, 5.6, 9, 14, 17, 20.2, 23, 24.5, 27, 31, 34.6, 35.6, 36.8, 40.5, 42.3, 44, 48.5, 51, 54, 57]) story.frame(wt, 0);

  let t = Math.min(Number(params.get('t') ?? 0), DURATION);
  let playing = false;
  let audio = null;
  let buffer = null;
  let source = null;
  let gain = null;
  let startAt = 0;
  let from = 0;
  let muted = false;
  let dirty = true;
  let lastWall = 0;

  const draw = () => {
    story.frame(t, Math.floor(t * FPS));
    ui.fill.style.width = `${(t / DURATION) * 100}%`;
    ui.time.textContent = `${fmt(t)} / ${fmt(DURATION).replace(/\.0$/, '')}`;
    if (!ui.debug.hidden) {
      const act = Object.entries(ACT)
        .filter(([, v]) => v <= t)
        .pop()?.[0];
      ui.debug.textContent = `${t.toFixed(2)}s · bar ${Math.floor(t / BAR) + 1} · ${act}`;
    }
  };

  // Poster: the lockup.
  const poster = params.has('t') ? t : ACT.lockup + 2.2;
  story.frame(poster, 0);
  ui.overlay.hidden = false;
  ui.toggle.innerHTML = ICON.play;
  ui.mute.innerHTML = ICON.sound;

  ui.status.textContent = 'Preparing sound';
  // The score is synthesised by audio.js. A pre-rendered, lossless copy loads instantly;
  // ?live (or a missing file) synthesises it in the page instead.
  const loadScore = async () => {
    if (!params.has('live')) {
      try {
        const res = await fetch('/assets/score.flac');
        if (res.ok) {
          const ctx = new OfflineAudioContext(2, 1, 48000);
          return await ctx.decodeAudioData(await res.arrayBuffer());
        }
      } catch {
        /* fall through to live synthesis */
      }
    }
    return renderScore({ typed: data.cashaddr.length });
  };
  const scoreReady = loadScore().then((b) => {
    buffer = b;
    ui.status.style.opacity = '0';
    ui.wav.disabled = false;
    return b;
  });
  ui.wav.disabled = true;

  const stopSource = () => {
    if (source) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
      source = null;
    }
  };

  const startSource = () => {
    stopSource();
    if (!audio || !buffer) return;
    source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    startAt = audio.currentTime + 0.05;
    from = t;
    source.start(startAt, t);
  };

  const play = async () => {
    if (!audio) {
      audio = new AudioContext({ latencyHint: 'playback', sampleRate: 48000 });
      gain = audio.createGain();
      gain.gain.value = muted ? 0 : 1;
      gain.connect(audio.destination);
    }
    await audio.resume();
    await scoreReady;
    if (t >= DURATION - 0.05) t = 0;
    playing = true;
    ui.overlay.hidden = true;
    ui.toggle.innerHTML = ICON.pause;
    startSource();
    lastWall = performance.now();
  };

  const pause = () => {
    playing = false;
    stopSource();
    ui.toggle.innerHTML = ICON.play;
    dirty = true;
  };

  const seek = (to) => {
    t = Math.max(0, Math.min(DURATION, to));
    if (playing) startSource();
    dirty = true;
  };

  const loop = (now) => {
    if (playing) {
      if (audio && source) {
        const lat = audio.outputLatency || audio.baseLatency || 0;
        const at = audio.currentTime - startAt - lat;
        t = Math.min(DURATION, from + Math.max(0, at));
      } else {
        t = Math.min(DURATION, t + (now - lastWall) / 1000);
      }
      lastWall = now;
      if (t >= DURATION) pause();
      draw();
    } else if (dirty) {
      dirty = false;
      draw();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const startWithOffset = startSource;
  const play2 = play;

  ui.big.onclick = () => (playing ? pause() : play2());
  ui.toggle.onclick = () => (playing ? pause() : play2());
  canvas.onclick = () => (playing ? pause() : play2());
  ui.mute.onclick = () => {
    muted = !muted;
    if (gain) gain.gain.value = muted ? 0 : 1;
    ui.mute.innerHTML = muted ? ICON.muted : ICON.sound;
  };
  ui.full.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  ui.wav.onclick = async () => {
    const b = await scoreReady;
    const url = URL.createObjectURL(toWav(b));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cachet-film.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const scrub = (e) => {
    const r = ui.bar.getBoundingClientRect();
    const to = ((e.clientX - r.left) / r.width) * DURATION;
    t = Math.max(0, Math.min(DURATION, to));
    if (playing) startWithOffset();
    dirty = true;
    ui.overlay.hidden = true;
  };
  ui.bar.addEventListener('pointerdown', (e) => {
    scrub(e);
    const move = (ev) => scrub(ev);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? pause() : play2();
    } else if (e.key === 'ArrowRight') {
      t = Math.min(DURATION, t + (e.shiftKey ? 0.1 : BAR));
      if (playing) startWithOffset();
      dirty = true;
      ui.overlay.hidden = true;
    } else if (e.key === 'ArrowLeft') {
      t = Math.max(0, t - (e.shiftKey ? 0.1 : BAR));
      if (playing) startWithOffset();
      dirty = true;
      ui.overlay.hidden = true;
    } else if (e.key === 'Home' || e.key === '0') {
      t = 0;
      if (playing) startWithOffset();
      dirty = true;
    } else if (e.key === 'f') ui.full.onclick();
    else if (e.key === 'm') ui.mute.onclick();
    else if (e.key === 'h') document.body.toggleAttribute('data-clean');
    else if (e.key === 'd') {
      ui.debug.hidden = !ui.debug.hidden;
      dirty = true;
    }
  });

  let idle;
  addEventListener('pointermove', () => {
    document.body.removeAttribute('data-idle');
    clearTimeout(idle);
    idle = setTimeout(() => playing && document.body.setAttribute('data-idle', ''), 1800);
  });

  if (params.has('clean')) document.body.setAttribute('data-clean', '');

  // Hooks for a frame-by-frame render later.
  window.__film = {
    duration: DURATION,
    seek: (s) => {
      t = s;
      dirty = true;
    },
    renderAt: (s) => {
      t = s;
      story.frame(s, Math.floor(s * FPS));
      return true;
    },
    play: play2,
    pause,
    get t() {
      return t;
    },
    score: () => scoreReady,
    wav: async () => toWav(await scoreReady),
  };
}

boot().catch((e) => {
  console.error(e);
  ui.status.textContent = String(e?.message ?? e);
});
