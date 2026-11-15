#!/usr/bin/env -S npx tsx
/**
 * cachet-verify — checks bch-nostr-bind/v1 bindings.
 *
 *   cachet-verify proof.json [--address <cashaddr>] [--now <unix>] [--json]
 *   cat proof.json | cachet-verify -
 *   cachet-verify --npub <npub|hex> [--relays wss://a,wss://b]      (online: resolve the latest snapshot)
 *
 * Offline mode uses no network at all. Exit code: 0 valid, 1 invalid, 2 usage error.
 */
import { readFileSync } from 'node:fs';
import { VERIFY_CODES, decodeNip19, verifyBinding, verifySnapshot, type VerifyResult } from '@cachet/core';
import { DEFAULT_RELAYS, lookupIdentity, uniqueRelays } from '@cachet/discovery';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const tty = process.stdout.isTTY && !has('json');
const c = (code: number, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c(32, s);
const red = (s: string) => c(31, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);

const usage = () => {
  console.error('usage: cachet-verify <event.json | -> [--address <cashaddr>] [--now <unix>] [--json]');
  console.error('       cachet-verify --npub <npub|hex> [--relays wss://a,wss://b] [--json]');
  process.exit(2);
};

const print = (r: VerifyResult) => {
  const head = r.ok ? green('✓ valid binding') : red(`✗ ${r.code}`) + dim(` · ${VERIFY_CODES[r.code]}`);
  console.log(bold(head));
  if (r.binding) {
    console.log(dim('  npub     ') + r.binding.npub);
    console.log(dim('  address  ') + r.binding.cashaddr);
    console.log(dim('  binding  ') + r.binding.bindingId);
    console.log(dim('  expires  ') + new Date(r.binding.expiresAt * 1000).toISOString());
  }
  for (const ch of r.checks) {
    const mark = ch.status === 'pass' ? green('✓') : ch.status === 'fail' ? red('✗') : dim('·');
    const detail = ch.status === 'fail' ? red(`${ch.code}${ch.detail ? ` — ${ch.detail}` : ''}`) : dim(ch.detail ?? (ch.status === 'skip' ? 'not reached' : ''));
    console.log(`  ${mark} ${ch.label.padEnd(24)} ${detail}`);
  }
};

const main = async () => {
  const now = flag('now') ? Number(flag('now')) : undefined;
  const npub = flag('npub');

  if (npub) {
    let pubkey = npub;
    if (npub.startsWith('npub1') || npub.startsWith('nprofile1')) {
      const d = decodeNip19(npub);
      pubkey = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : '';
    }
    if (!/^[0-9a-f]{64}$/.test(pubkey)) usage();
    const relays = flag('relays') ? uniqueRelays(flag('relays')!.split(',')) : DEFAULT_RELAYS;
    const r = await lookupIdentity(pubkey, { relays, ...(now ? { now } : {}) });
    if (has('json')) {
      console.log(JSON.stringify({ state: r.resolution.state, claims: r.resolution.claims, relays: r.relays.map(({ events, ...x }) => ({ ...x, events: events.length })) }, null, 2));
    } else {
      console.log(bold(`state: ${r.resolution.state}`) + dim(`  (${r.relays.filter((x) => x.status === 'ok').length}/${r.relays.length} relays answered)`));
      for (const x of r.relays) console.log(dim(`  ${x.status.padEnd(13)} ${String(x.ms).padStart(5)} ms  ${x.url}`));
      for (const claim of r.resolution.claims) {
        console.log();
        if (claim.result) print(claim.result);
        else console.log(bold(`${claim.state}: ${claim.cashaddr}`) + dim(` (removed by ${claim.withdrawnBy?.slice(0, 12)}…)`));
      }
    }
    process.exit(r.resolution.state === 'active' ? 0 : 1);
  }

  const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1]?.startsWith('--') && args[i - 1] !== '-'));
  if (!file) usage();
  const raw = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file!, 'utf8');
  const address = flag('address');
  let results: VerifyResult[];
  if (address) results = [verifyBinding(raw, { cashaddr: address, ...(now ? { now } : {}) })];
  else {
    const snap = verifySnapshot(raw, now ? { now } : {});
    results = snap.claims.length ? snap.claims : [verifyBinding(raw, now ? { now } : {})];
  }
  if (has('json')) console.log(JSON.stringify(results.map(({ event: _e, ...r }) => r), null, 2));
  else results.forEach((r, i) => (i && console.log(), print(r)));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
};

main().catch((e) => {
  console.error(red(String(e instanceof Error ? e.message : e)));
  process.exit(2);
});
