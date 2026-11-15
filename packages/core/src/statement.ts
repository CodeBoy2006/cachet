import { npubEncode } from 'nostr-tools/nip19';
import { parseCashAddr, isAddressError } from './cashaddr.ts';
import {
  DEFAULT_TTL_SECONDS,
  MAX_PROOF_BYTES,
  MAX_UNIX_SECONDS,
  MESSAGE_HEADER,
  MESSAGE_INTRO,
  NETWORKS,
  PROFILE_TYPE,
  type Network,
} from './constants.ts';
import { isLowerHex, isSafeUnixSeconds, randomHex, sha256Hex } from './bytes.ts';
import { canonicalize } from './jcs.ts';
import type { VerifyCode } from './codes.ts';

/** The object both keys commit to. Field set is closed: unknown keys are rejected. */
export interface BindStatement {
  version: 1;
  purpose: 'bind';
  network: Network;
  cashaddr: string;
  nostr_pubkey: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

/** What the `i` tag carries, serialized with JCS. */
export interface BindProof {
  type: typeof PROFILE_TYPE;
  statement: BindStatement;
  bch_signature: string;
}

const STATEMENT_KEYS = ['cashaddr', 'expires_at', 'issued_at', 'network', 'nonce', 'nostr_pubkey', 'purpose', 'version'];
const PROOF_KEYS = ['bch_signature', 'statement', 'type'];

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export const createStatement = (input: {
  cashaddr: string;
  nostrPubkey: string;
  issuedAt?: number;
  ttlSeconds?: number;
  nonce?: string;
}): BindStatement => {
  const parsed = parseCashAddr(input.cashaddr);
  if (isAddressError(parsed)) throw new Error(`Invalid address: ${parsed.detail}`);
  if (!parsed.singleKey) throw new Error('Only P2PKH addresses can be bound by message signature');
  if (parsed.network === 'regtest') throw new Error('Regtest addresses are not supported');
  if (!isLowerHex(input.nostrPubkey, 32)) throw new Error('Nostr public key must be 64 lowercase hex');
  const issued = input.issuedAt ?? nowSeconds();
  return {
    version: 1,
    purpose: 'bind',
    network: parsed.network,
    cashaddr: parsed.address,
    nostr_pubkey: input.nostrPubkey,
    issued_at: issued,
    expires_at: issued + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    nonce: input.nonce ?? randomHex(32),
  };
};

/** The exact text the BCH wallet signs. Three lines, no trailing newline. */
export const bindMessage = (statement: BindStatement): string =>
  `${MESSAGE_HEADER}\n${MESSAGE_INTRO}${npubEncode(statement.nostr_pubkey)}\n${canonicalize(statement)}`;

/** Identifies the statement (not a particular Nostr snapshot, not the signature bytes). */
export const bindingIdOf = (message: string): string => sha256Hex(message);

export const serializeProof = (proof: BindProof): string => canonicalize(proof);

type Fail = { ok: false; code: VerifyCode; detail: string };

const hasExactKeys = (obj: Record<string, unknown>, keys: string[]) => {
  const own = Object.keys(obj).sort();
  return own.length === keys.length && own.every((k, i) => k === keys[i]);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const checkStatement = (value: unknown): { ok: true; statement: BindStatement } | Fail => {
  if (!isPlainObject(value)) return { ok: false, code: 'proof_malformed', detail: 'statement is not an object' };
  if (value.version !== 1 || value.purpose !== 'bind') {
    return { ok: false, code: 'unsupported_profile', detail: 'expected version 1, purpose "bind"' };
  }
  if (!hasExactKeys(value, STATEMENT_KEYS)) {
    return { ok: false, code: 'proof_malformed', detail: `statement fields must be exactly: ${STATEMENT_KEYS.join(', ')}` };
  }
  if (!NETWORKS.includes(value.network as Network)) {
    return { ok: false, code: 'proof_malformed', detail: 'network must be "mainnet" or "chipnet"' };
  }
  if (typeof value.cashaddr !== 'string') return { ok: false, code: 'proof_malformed', detail: 'cashaddr is not a string' };
  if (!isLowerHex(value.nostr_pubkey, 32)) {
    return { ok: false, code: 'proof_malformed', detail: 'nostr_pubkey must be 64 lowercase hex' };
  }
  if (!isLowerHex(value.nonce, 32)) return { ok: false, code: 'proof_malformed', detail: 'nonce must be 64 lowercase hex' };
  if (!isSafeUnixSeconds(value.issued_at) || !isSafeUnixSeconds(value.expires_at)) {
    return { ok: false, code: 'proof_malformed', detail: 'timestamps must be non-negative safe integers' };
  }
  if (value.issued_at > MAX_UNIX_SECONDS || value.expires_at > MAX_UNIX_SECONDS) {
    return { ok: false, code: 'proof_malformed', detail: 'timestamps look like milliseconds; use Unix seconds' };
  }
  if (value.expires_at <= value.issued_at) {
    return { ok: false, code: 'proof_malformed', detail: 'expires_at must be after issued_at' };
  }
  return { ok: true, statement: value as unknown as BindStatement };
};

/** Strict proof parser: size limit, JSON, closed shape, canonical encoding. */
export const parseProof = (raw: unknown): { ok: true; proof: BindProof } | Fail => {
  if (typeof raw !== 'string') return { ok: false, code: 'proof_malformed', detail: 'proof is not a string' };
  if (raw.length > MAX_PROOF_BYTES) return { ok: false, code: 'proof_malformed', detail: 'proof too large' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'proof_malformed', detail: 'proof is not JSON' };
  }
  if (!isPlainObject(value)) return { ok: false, code: 'proof_malformed', detail: 'proof is not an object' };
  if (value.type !== PROFILE_TYPE) {
    return { ok: false, code: 'unsupported_profile', detail: `type must be "${PROFILE_TYPE}"` };
  }
  if (!hasExactKeys(value, PROOF_KEYS)) {
    return { ok: false, code: 'proof_malformed', detail: `proof fields must be exactly: ${PROOF_KEYS.join(', ')}` };
  }
  if (typeof value.bch_signature !== 'string') {
    return { ok: false, code: 'proof_malformed', detail: 'bch_signature is not a string' };
  }
  const statement = checkStatement(value.statement);
  if (!statement.ok) return statement;
  // Duplicate keys, whitespace and key order all show up as a canonical-form mismatch.
  let canonical: string;
  try {
    canonical = canonicalize(value);
  } catch {
    return { ok: false, code: 'proof_malformed', detail: 'proof contains invalid strings' };
  }
  if (canonical !== raw) {
    return { ok: false, code: 'proof_not_canonical', detail: 'proof must be RFC 8785 canonical JSON' };
  }
  return { ok: true, proof: value as unknown as BindProof };
};
