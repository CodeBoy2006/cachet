/**
 * Stable error codes. Integrators branch on these, so they are part of the public API.
 */
export const VERIFY_CODES = {
  ok: 'Valid',
  malformed_event: 'Event is not a well-formed Nostr event',
  wrong_kind: 'Event is not a kind 10011 identity snapshot',
  event_id_mismatch: 'Event id does not match its contents',
  event_signature_invalid: 'Nostr signature is invalid',
  claim_missing: 'No BCH claim in this snapshot',
  claim_ambiguous: 'More than one matching BCH claim',
  proof_malformed: 'Proof is not valid JSON of the expected shape',
  proof_not_canonical: 'Proof is not in canonical (RFC 8785) form',
  unsupported_profile: 'Unknown proof type, version or purpose',
  pubkey_mismatch: 'Statement names a different Nostr key',
  address_mismatch: 'Claim and statement name different addresses',
  address_invalid: 'Address is not a canonical CashAddr',
  unsupported_address_type: 'Only P2PKH addresses can prove control by signature',
  network_mismatch: 'Network does not match the address prefix',
  not_yet_valid: 'Timestamps are in the future',
  expired: 'Binding has expired',
  bch_signature_malformed: 'BCH signature is not a 65-byte compact signature',
  signature_invalid: 'BCH signature does not come from this address',
  key_reuse: 'The same key is used on both sides',
} as const;

export type VerifyCode = keyof typeof VERIFY_CODES;

export const AUTH_CODES = {
  ok: 'Authenticated',
  auth_missing: 'No Authorization: Nostr header',
  auth_malformed: 'Authorization event is malformed',
  auth_kind: 'Authorization event is not kind 27235',
  auth_signature_invalid: 'Authorization signature is invalid',
  auth_url_mismatch: 'Signed URL does not match this endpoint',
  auth_method_mismatch: 'Signed HTTP method does not match',
  auth_payload_mismatch: 'Signed body hash does not match the request body',
  auth_stale: 'Authorization event is outside the time window',
  auth_pubkey_mismatch: 'Signed by a different Nostr key than the challenge expects',
  challenge_unknown: 'Unknown challenge',
  challenge_expired: 'Challenge expired',
  challenge_used: 'Challenge already used',
  session_mismatch: 'Challenge was issued to a different browser session',
  binding_inactive: 'No active BCH binding for this key',
} as const;

export type AuthCode = keyof typeof AUTH_CODES;

export type BindingState = 'active' | 'withdrawn' | 'expired' | 'invalid' | 'not_found' | 'unavailable';

export const STATE_LABELS: Record<BindingState, string> = {
  active: 'Active',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  invalid: 'Invalid',
  not_found: 'Not found',
  unavailable: 'Relays unavailable',
};
