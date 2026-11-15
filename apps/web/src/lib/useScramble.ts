import { useEffect, useRef, useState } from 'react';

export const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export const HEX = '0123456789abcdef';
export const HEX_UPPER = '0123456789ABCDEF';
export const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const pick = (charset: string) => charset[(Math.random() * charset.length) | 0]!;

/**
 * Resolves `target` left to right out of random glyphs from `charset`. Characters the
 * previous value shares at the same position stay put, so an edit only churns what changed.
 * Separators (anything outside the charset) are never scrambled.
 */
export const useScramble = (target: string, { charset = BECH32, duration = 460, delay = 0 } = {}) => {
  const [text, setText] = useState(() =>
    prefersReducedMotion() ? target : [...target].map((ch) => (charset.includes(ch) || charset.includes(ch.toLowerCase()) ? pick(charset) : ch)).join(''),
  );
  const prev = useRef('');

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (!target || prefersReducedMotion() || from === target) {
      setText(target);
      return;
    }
    const lower = charset === HEX || charset === BECH32;
    const set = lower ? charset + charset.toUpperCase() : charset;
    const settles = [...target].map((ch, i) =>
      ch === from[i] || !set.includes(ch) ? -1 : 0.18 + (i / Math.max(1, target.length - 1)) * 0.72 + Math.random() * 0.1,
    );
    let raf = 0;
    let start = 0;
    let frame = 0;
    let done = false;
    const tick = (now: number) => {
      start ||= now;
      const p = Math.min(1, Math.max(0, (now - start - delay) / duration));
      // ~30fps is plenty for glyph churn and halves React work.
      if (frame++ % 2 === 0 || p >= 1) {
        let out = '';
        for (let i = 0; i < target.length; i++) {
          const ch = target[i]!;
          const s = settles[i]!;
          if (s < 0 || p >= s) out += ch;
          else {
            const g = pick(charset);
            out += lower && ch !== ch.toLowerCase() ? g.toUpperCase() : g;
          }
        }
        setText(out);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
      else done = true;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted (StrictMode remount, or a new target): the next run starts from the old value.
      if (!done && prev.current === target) prev.current = from;
    };
  }, [target, charset, duration, delay]);

  return text;
};
