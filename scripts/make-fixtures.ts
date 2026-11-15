/**
 * Writes example bindings to fixtures/ for the CLI and for other implementations
 * to test against. Throwaway keys; nothing is published.
 *
 *   npx tsx scripts/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { bindMessage, canonicalize, claimTag, createStatement, serializeProof, verifyBinding, type BindProof } from '@cachet/core';
import { LocalBchSigner, LocalNostrSigner } from '@cachet/signers';

const at = 1_794_600_000; // 2026-11-13, fixed so fixtures stay deterministic in time
const dir = new URL('../fixtures/', import.meta.url);
mkdirSync(dir, { recursive: true });

const make = (opts: { sameKey?: boolean; tokenAware?: boolean } = {}) => {
  const secret = generateSecretKey();
  const nostr = new LocalNostrSigner(secret);
  const bch = opts.sameKey ? new LocalBchSigner(secret) : LocalBchSigner.generate();
  const statement = createStatement({ cashaddr: bch.address(opts.tokenAware), nostrPubkey: nostr.pubkey, issuedAt: at, ttlSeconds: 365 * 86400 * 10 });
  const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: bch.signRaw(bindMessage(statement)) };
  return { secret, statement, proof, bch };
};

const write = (name: string, event: unknown, expect: string) => {
  writeFileSync(new URL(name, dir), `${JSON.stringify(event, null, 2)}\n`);
  const got = verifyBinding(event, { now: at + 3600 });
  console.log(`${name.padEnd(28)} expect ${expect.padEnd(20)} got ${got.code}`);
  if (got.code !== expect) process.exitCode = 1;
  return { name, expect };
};

const cases = [];
const valid = make();
const validEvent = finalizeEvent({ kind: 10011, created_at: at + 60, tags: [['i', 'github:example', 'gist'], claimTag(valid.proof)], content: '' }, valid.secret);
cases.push(write('valid.json', validEvent, 'ok'));

const token = make({ tokenAware: true });
cases.push(write('valid-token-aware.json', finalizeEvent({ kind: 10011, created_at: at + 60, tags: [claimTag(token.proof)], content: '' }, token.secret), 'ok'));

const thief = generateSecretKey();
cases.push(write('replayed-npub.json', finalizeEvent({ kind: 10011, created_at: at + 60, tags: [claimTag(valid.proof)], content: '' }, thief), 'pubkey_mismatch'));

const reuse = make({ sameKey: true });
cases.push(write('key-reuse.json', finalizeEvent({ kind: 10011, created_at: at + 60, tags: [claimTag(reuse.proof)], content: '' }, reuse.secret), 'key_reuse'));

const pretty = finalizeEvent({ kind: 10011, created_at: at + 60, tags: [['i', `bch:${valid.statement.cashaddr}`, JSON.stringify(valid.proof, null, 1)]], content: '' }, valid.secret);
cases.push(write('non-canonical.json', pretty, 'proof_not_canonical'));

const other = LocalBchSigner.generate().address();
const swapped = { ...valid.proof, statement: { ...valid.statement, cashaddr: other } };
cases.push(write('swapped-address.json', finalizeEvent({ kind: 10011, created_at: at + 60, tags: [['i', `bch:${other}`, canonicalize(swapped)]], content: '' }, valid.secret), 'signature_invalid'));

cases.push(write('edited-after-signing.json', { ...validEvent, content: 'edited' }, 'event_id_mismatch'));

writeFileSync(new URL('index.json', dir), `${JSON.stringify({ now: at + 3600, cases, message_example: bindMessage(valid.statement), proof_example: serializeProof(valid.proof) }, null, 2)}\n`);
