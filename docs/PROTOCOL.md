# bch-nostr-bind/v1

A public, verifiable link between a Bitcoin Cash P2PKH address and a Nostr key, carried as a NIP-39 claim.
Status: experimental profile on top of NIP-39. It is not an accepted NIP; the `bch` platform name is proposed here.

Reference implementation: [`packages/core`](../packages/core/src) (pure, no network). Shared vectors: [`fixtures/`](../fixtures).

## 1. What both keys sign

### 1.1 Statement

```json
{
  "cashaddr": "bitcoincash:qzd2rgu5sv33txdmuygp2nkz5jmdsl8zcq0mdw4ly9",
  "expires_at": 1797192000,
  "issued_at": 1794600000,
  "network": "mainnet",
  "nonce": "<64 lowercase hex, 32 random bytes>",
  "nostr_pubkey": "<64 lowercase hex, x-only>",
  "purpose": "bind",
  "version": 1
}
```

| Field | Rule |
|---|---|
| `version`, `purpose` | `1`, `"bind"` |
| `network` | `"mainnet"` or `"chipnet"`; must match the CashAddr prefix (`bitcoincash` / `bchtest`) |
| `cashaddr` | Full, lowercase, checksummed CashAddr. Type 0 (P2PKH) or type 2 (token-aware P2PKH) only |
| `nostr_pubkey` | 32-byte x-only key of the Nostr identity, lowercase hex |
| `issued_at`, `expires_at` | Unix **seconds**, safe integers, `expires_at > issued_at`. Values above 99,999,999,999 are rejected as milliseconds |
| `nonce` | 32 random bytes, lowercase hex. Distinguishes statements; it is **not** a login challenge |

The field set is closed. Unknown fields are rejected so one statement cannot have two readings.

### 1.2 Message signed by the BCH wallet

Three lines joined by `\n`, no trailing newline:

```text
BCH-NOSTR-ID/v1
Verifying that I control the following Nostr public key: <npub of nostr_pubkey>
<RFC 8785 JCS encoding of the statement>
```

The wallet signs this text with **Bitcoin Signed Message** (the format of Electron Cash, Cashonize and WalletConnect `bch_signMessage`):

```
hash      = SHA256(SHA256( CompactSize(24) ‖ "Bitcoin Signed Message:\n" ‖ CompactSize(len(M)) ‖ UTF-8(M) ))
signature = Base64( header ‖ r ‖ s ),   header = 27 + recid (+4 when the key is compressed)
```

`binding_id = SHA256(UTF-8(M))` identifies the statement. Do not use signature bytes as an identifier: an ECDSA signature has a malleated twin that proves the same thing.

### 1.3 Proof and Nostr claim

```json
{"bch_signature":"<base64>","statement":{…},"type":"bch-nostr-bind/v1"}
```

The proof is serialized with JCS and placed, as a string, in a NIP-39 `i` tag of the author's kind `10011` event:

```json
["i", "bch:<cashaddr>", "<JCS proof>"]
```

Order of signing: statement → BCH signature over M → proof into the tag → Nostr signature over the event.
The BCH signature names the Nostr key; the Nostr signature covers the BCH proof. Neither needs the other's id, so there is no cycle.

## 2. Verifying one claim

`verifyBinding(event, { now, cashaddr?, networks? })` returns every check, not a boolean. A conforming verifier performs:

| # | Check | Failure code |
|---|---|---|
| 1 | Rebuild the event from its JSON fields (drop cached verification); kind 10011; id = SHA256 of serialization; BIP-340 signature valid | `malformed_event`, `wrong_kind`, `event_id_mismatch`, `event_signature_invalid` |
| 2 | Exactly one `i` tag for the requested `bch:` identity (or exactly one BCH claim if none requested) | `claim_missing`, `claim_ambiguous` |
| 3 | Proof parses, has exactly the documented fields, and equals its own JCS encoding (rejects duplicate keys, whitespace, reordering) | `proof_malformed`, `proof_not_canonical`, `unsupported_profile` |
| 4 | `statement.nostr_pubkey == event.pubkey`; tag identity == `bch:` + `statement.cashaddr` | `pubkey_mismatch`, `address_mismatch` |
| 5 | Address is canonical and P2PKH (type 0 or 2) | `address_invalid`, `unsupported_address_type` |
| 6 | `network` matches the prefix and the verifier's policy | `network_mismatch` |
| 7 | `issued_at ≤ event.created_at + skew`, `event.created_at ≤ now + skew`, `now < expires_at` (skew default 300 s) | `not_yet_valid`, `expired` |
| 8 | Strict Base64, 65 bytes, header 27–34, `0 < r,s < n`; recover the key over M; HASH160 of the key, serialized as the header says, equals the address payload. High-S is accepted | `bch_signature_malformed`, `signature_invalid` |
| 9 | x-coordinate of the recovered BCH key ≠ Nostr key | `key_reuse` |

Check 9 compares x-coordinates because BIP-340 keys are x-only: `d` and `n−d` share one. Comparing 33-byte keys or addresses misses that case. The check does not prove the two keys were generated independently; signers should use separate derivation paths.

BCH Schnorr signatures and BIP-340 are different schemes and are not interchangeable. This profile uses ECDSA message signatures on the BCH side.

## 3. Resolving the current state

kind 10011 is replaceable per author. The whole event is one snapshot of all of that person's external identities.

1. Query **author + kind 10011** on the author's NIP-65 write relays plus configured relays. Never pre-filter by `#i`: a newer snapshot that removed the claim would be filtered out.
2. Validate every returned event (author, kind, id, signature). Order by `created_at` descending, then lowest `id` (NIP-01).
3. Read claims **only from the newest valid snapshot**. If it lacks the claim, the claim is gone; if it is expired or broken, that is the answer. Never fall back to an older snapshot that "still worked".
4. Remember the newest snapshot seen per author so a lagging relay cannot roll you back.

| State | Meaning |
|---|---|
| `active` | Newest snapshot has the claim and every check passes |
| `expired` | Newest snapshot has the claim; only the validity window fails |
| `invalid` | Newest snapshot has the claim; another check fails |
| `withdrawn` | An older valid snapshot had the claim; the newest one does not |
| `not_found` | Relays answered; no snapshot carries the claim |
| `unavailable` | No relay answered. Not the same as "invalid" |

Results carry `observedAt` and per-relay outcomes. Open relay networks cannot prove that no newer snapshot exists anywhere; report what was checked.

**Update** = sign a new snapshot that keeps every other `i` tag and replaces this one. **Withdraw** = sign a new snapshot without it. `created_at` must be strictly greater than the previous snapshot. NIP-09 deletion may be added, but old copies can survive; the newest snapshot is what counts.

Reverse lookup (address → npubs) queries `#i` with both the `q…` and `z…` forms, then resolves each candidate through steps 1–4. Several npubs may claim one address.

## 4. Signing in (relying parties)

NIP-98 alone has no server-side one-time nonce. This profile adds one:

1. `POST /api/challenge` → `{ challenge_id, nonce, url, expires_at }`, bound to a pre-login cookie. If the client sends `pubkey`, the RP resolves the binding first and returns its `binding_id`.
2. Client signs a kind 27235 event: `u` = the exact verify URL, `method` = `POST`, `payload` = SHA256 of the exact body bytes `{"challenge_id","nonce"[,"binding_id"]}`.
3. RP checks: challenge exists, belongs to this browser, not expired → event signature, URL, method, body hash, ±60 s → nonce (and binding id) → **atomically consumes** the challenge → always resolves and verifies the current active, unexpired binding, even if it was resolved when issuing the challenge → checks that any address shown at challenge time is unchanged → creates its own HttpOnly session. Session access also requires the binding to remain within its validity window.

Failures before consumption leave the challenge usable (a wrong body cannot burn a good login). Concurrent replays of one signed request succeed at most once.

A login proves current control of the Nostr key. The BCH signature in the binding proves control of the address when the binding was made. An action that needs current control of both should ask for a fresh BCH signature over its own challenge.

## 5. Legacy and neighbours

- `kind 30078` with `d=paytaca:bch-address`: an address **announced** by a Nostr key, with no BCH proof. `lookupIdentity()` provides read-only awareness as `legacy` only when no kind 10011 snapshot exists (`!resolution.latest`). Display it as "announced by this npub", never as verified; the resolution state is unchanged. Any kind 10011 snapshot, including an empty or withdrawn one, suppresses legacy discovery. NIP-78 reserves 30078 for app-private data; new public bindings use kind 10011.
- Other dual-signature formats can be supported by separate adapters; the core verifier keeps one strict format.
