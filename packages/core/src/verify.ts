import { binToHex } from '@bitauth/libauth';
import { npubEncode } from 'nostr-tools/nip19';
import { recoverSigner } from './bsm.ts';
import { equalBytes } from './bytes.ts';
import { isAddressError, normalizeCashAddrInput, parseCashAddr } from './cashaddr.ts';
import type { VerifyCode } from './codes.ts';
import { DEFAULT_CLOCK_SKEW, KIND_EXTERNAL_IDENTITIES, type Network } from './constants.ts';
import { checkEventSignature, findBchClaims, rebuildEvent, type NostrEvent } from './event.ts';
import { bindingIdOf, bindMessage, nowSeconds, parseProof, type BindStatement } from './statement.ts';

export type CheckId =
  | 'event'
  | 'claim'
  | 'statement'
  | 'identity'
  | 'address'
  | 'network'
  | 'time'
  | 'bch_signature'
  | 'key_separation';

export const CHECK_ORDER: CheckId[] = [
  'event',
  'claim',
  'statement',
  'identity',
  'address',
  'network',
  'time',
  'bch_signature',
  'key_separation',
];

export const CHECK_LABELS: Record<CheckId, string> = {
  event: 'Nostr signature',
  claim: 'BCH claim',
  statement: 'Statement format',
  identity: 'Statement matches event',
  address: 'Address type',
  network: 'Network',
  time: 'Validity window',
  bch_signature: 'BCH signature',
  key_separation: 'Separate keys',
};

export interface Check {
  id: CheckId;
  label: string;
  status: 'pass' | 'fail' | 'skip';
  code?: VerifyCode;
  detail?: string;
}

export interface BindingDetails {
  eventId: string;
  eventCreatedAt: number;
  nostrPubkey: string;
  npub: string;
  cashaddr: string;
  network: Network;
  tokenAware: boolean;
  issuedAt: number;
  expiresAt: number;
  bindingId: string;
  message: string;
  statement: BindStatement;
  bchSignature: string;
  /** Hex of the public key recovered from the BCH signature, when it recovers. */
  bchPublicKey?: string;
}

export interface VerifyResult {
  ok: boolean;
  code: VerifyCode;
  checks: Check[];
  event?: NostrEvent;
  binding?: BindingDetails;
}

export interface VerifyOptions {
  /** Unix seconds. Defaults to the current time. */
  now?: number;
  /** Select the claim for this address (required when a snapshot holds several). */
  cashaddr?: string;
  clockSkew?: number;
  /** Networks this verifier accepts. Defaults to both. */
  networks?: Network[];
}

const isoDate = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

/**
 * Verifies one BCH claim inside a kind 10011 snapshot. Pure: no network, no clock
 * unless `now` is omitted. Returns every check, not just the first failure.
 */
export const verifyBinding = (input: unknown, options: VerifyOptions = {}): VerifyResult => {
  const now = options.now ?? nowSeconds();
  const skew = options.clockSkew ?? DEFAULT_CLOCK_SKEW;
  const checks = new Map<CheckId, Check>(
    CHECK_ORDER.map((id) => [id, { id, label: CHECK_LABELS[id], status: 'skip' }]),
  );
  const pass = (id: CheckId, detail?: string) =>
    checks.set(id, { id, label: CHECK_LABELS[id], status: 'pass', ...(detail ? { detail } : {}) });
  const fail = (id: CheckId, code: VerifyCode, detail?: string) =>
    checks.set(id, { id, label: CHECK_LABELS[id], status: 'fail', code, ...(detail ? { detail } : {}) });

  let event: NostrEvent | undefined;
  let binding: BindingDetails | undefined;
  const finish = (): VerifyResult => {
    const list = CHECK_ORDER.map((id) => checks.get(id)!);
    const failed = list.find((c) => c.status === 'fail');
    return {
      ok: !failed,
      code: failed?.code ?? 'ok',
      checks: list,
      ...(event ? { event } : {}),
      ...(binding ? { binding } : {}),
    };
  };

  // 1. Outer event
  const rebuilt = rebuildEvent(input);
  if (!rebuilt.ok) {
    fail('event', 'malformed_event', rebuilt.detail);
    return finish();
  }
  event = rebuilt.event;
  if (event.kind !== KIND_EXTERNAL_IDENTITIES) {
    fail('event', 'wrong_kind', `kind ${event.kind}`);
    return finish();
  }
  const sig = checkEventSignature(event);
  if (!sig.ok) {
    fail('event', sig.code);
    return finish();
  }
  pass('event', `kind 10011 by ${npubEncode(event.pubkey).slice(0, 12)}…`);

  // 2. Claim selection
  let claims = findBchClaims(event.tags);
  if (options.cashaddr !== undefined) {
    const raw = options.cashaddr;
    const wanted = normalizeCashAddrInput(raw);
    const exact = claims.filter((c) => c.cashaddr === raw);
    if (exact.length === 0 && isAddressError(wanted)) {
      fail('claim', 'address_invalid', `requested address: ${wanted.detail}`);
      return finish();
    }
    claims = exact.length ? exact : claims.filter((c) => !isAddressError(wanted) && c.cashaddr === wanted.address);
  }
  if (claims.length === 0) {
    fail('claim', 'claim_missing');
    return finish();
  }
  if (claims.length > 1) {
    fail('claim', 'claim_ambiguous', `${claims.length} BCH claims; choose one by address`);
    return finish();
  }
  const claim = claims[0]!;
  pass('claim', claim.identity);

  // 3. Proof and statement
  const parsed = parseProof(claim.proof);
  if (!parsed.ok) {
    fail('statement', parsed.code, parsed.detail);
    return finish();
  }
  const { statement, bch_signature: bchSignature } = parsed.proof;
  const message = bindMessage(statement);
  pass('statement', 'bch-nostr-bind/v1, canonical');

  const address = parseCashAddr(statement.cashaddr);
  binding = {
    eventId: event.id,
    eventCreatedAt: event.created_at,
    nostrPubkey: statement.nostr_pubkey,
    npub: npubEncode(statement.nostr_pubkey),
    cashaddr: statement.cashaddr,
    network: statement.network,
    tokenAware: !isAddressError(address) && address.tokenAware,
    issuedAt: statement.issued_at,
    expiresAt: statement.expires_at,
    bindingId: bindingIdOf(message),
    message,
    statement,
    bchSignature,
  };

  // 4. Both sides name each other
  if (statement.nostr_pubkey !== event.pubkey) {
    fail('identity', 'pubkey_mismatch', 'statement was signed for another npub');
  } else if (claim.cashaddr !== statement.cashaddr) {
    fail('identity', 'address_mismatch', 'tag and statement disagree');
  } else {
    pass('identity');
  }

  // 5. Address
  if (isAddressError(address)) {
    fail('address', 'address_invalid', address.detail);
  } else if (!address.singleKey) {
    fail('address', 'unsupported_address_type', `${address.type} cannot sign messages`);
  } else {
    pass('address', address.tokenAware ? 'P2PKH, token-aware' : 'P2PKH');
  }

  // 6. Network
  if (!isAddressError(address)) {
    if (address.network !== statement.network) {
      fail('network', 'network_mismatch', `${statement.cashaddr.split(':')[0]} is not ${statement.network}`);
    } else if (options.networks && !options.networks.includes(statement.network)) {
      fail('network', 'network_mismatch', `${statement.network} not accepted here`);
    } else {
      pass('network', statement.network);
    }
  }

  // 7. Time
  if (statement.issued_at > event.created_at + skew) {
    fail('time', 'not_yet_valid', 'statement issued after the event was signed');
  } else if (event.created_at > now + skew || statement.issued_at > now + skew) {
    fail('time', 'not_yet_valid', 'timestamp is in the future');
  } else if (now >= statement.expires_at) {
    fail('time', 'expired', `expired ${isoDate(statement.expires_at)}`);
  } else {
    pass('time', `until ${isoDate(statement.expires_at)}`);
  }

  // 8. BCH signature over the exact message
  if (!isAddressError(address) && address.singleKey) {
    const recovered = recoverSigner(message, bchSignature);
    if (!recovered.ok) {
      fail('bch_signature', recovered.code, recovered.detail);
    } else if (!equalBytes(recovered.publicKeyHash, address.payload)) {
      fail('bch_signature', 'signature_invalid', 'recovers a different address');
    } else {
      binding.bchPublicKey = binToHex(recovered.publicKey);
      pass('bch_signature', `${recovered.compressed ? 'compressed' : 'uncompressed'} key`);
      // 9. x-only comparison catches d and n−d as well as identical keys.
      const xOnly = binToHex(recovered.publicKey.slice(1, 33));
      if (xOnly === event.pubkey) fail('key_separation', 'key_reuse', 'BCH key and Nostr key share an x-coordinate');
      else pass('key_separation');
    }
  }

  return finish();
};

export interface SnapshotVerification {
  event?: NostrEvent;
  eventCheck: Check;
  claims: VerifyResult[];
}

/** Verifies every BCH claim in a snapshot. */
export const verifySnapshot = (input: unknown, options: Omit<VerifyOptions, 'cashaddr'> = {}): SnapshotVerification => {
  const label = CHECK_LABELS.event;
  const rebuilt = rebuildEvent(input);
  if (!rebuilt.ok) {
    return { eventCheck: { id: 'event', label, status: 'fail', code: 'malformed_event', detail: rebuilt.detail }, claims: [] };
  }
  const event = rebuilt.event;
  if (event.kind !== KIND_EXTERNAL_IDENTITIES) {
    return { event, eventCheck: { id: 'event', label, status: 'fail', code: 'wrong_kind' }, claims: [] };
  }
  const sig = checkEventSignature(event);
  if (!sig.ok) return { event, eventCheck: { id: 'event', label, status: 'fail', code: sig.code }, claims: [] };
  const addresses = [...new Set(findBchClaims(event.tags).map((c) => c.cashaddr))];
  return {
    event,
    eventCheck: { id: 'event', label, status: 'pass' },
    claims: addresses.map((cashaddr) => verifyBinding(event, { ...options, cashaddr })),
  };
};

/** Only the validity window failed, and it failed because time ran out. */
export const isOnlyExpired = (result: VerifyResult) => {
  const failed = result.checks.filter((c) => c.status === 'fail');
  return failed.length === 1 && failed[0]!.code === 'expired';
};
