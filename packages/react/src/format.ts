import { npubEncode } from '@cachet/core';

export const shortMiddle = (value: string, head = 8, tail = 6) =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

export const shortNpub = (pubkeyOrNpub: string) =>
  shortMiddle(pubkeyOrNpub.startsWith('npub1') ? pubkeyOrNpub : npubEncode(pubkeyOrNpub), 10, 6);

export const shortCashaddr = (address: string, head = 7, tail = 6) =>
  shortMiddle(address.includes(':') ? address.split(':')[1]! : address, head, tail);

/** `noun` after `n`, plural unless n is 1: plural(3, 'relay') → 'relays'. */
export const plural = (n: number, noun: string, many = `${noun}s`) => (n === 1 ? noun : many);

export const relayHost = (url: string) => url.replace(/^wss?:\/\//, '').replace(/\/$/, '');

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatDate = (unix: number) => dateFmt.format(new Date(unix * 1000));
export const formatDateTime = (unix: number) => dateTimeFmt.format(new Date(unix * 1000));

export const relativeTime = (unix: number, now = Date.now() / 1000) => {
  const d = unix - now;
  const abs = Math.abs(d);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(d), 'second');
  if (abs < 3600) return rtf.format(Math.round(d / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  if (abs < 86400 * 60) return rtf.format(Math.round(d / 86400), 'day');
  return rtf.format(Math.round(d / (86400 * 30)), 'month');
};

/** Deterministic two-tone avatar from a pubkey, for profiles without a picture. */
export const avatarGradient = (pubkey: string) => {
  const h1 = parseInt(pubkey.slice(0, 4), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(pubkey.slice(4, 6), 16) % 80)) % 360;
  return `linear-gradient(135deg, oklch(0.78 0.08 ${h1}), oklch(0.62 0.1 ${h2}))`;
};
