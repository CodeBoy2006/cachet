# Wallet integration

For wallet teams (Paytaca, Cashonize, Selene, Zapit…). Two features, each a few lines with `@cachet/core` and `@cachet/discovery`.

## A. "Send to npub" — resolve before paying

```ts
import { lookupIdentity, parseIdentityInput, resolveNip05 } from '@cachet/discovery';

async function resolvePayee(input: string) {
  const id = parseIdentityInput(input);                 // npub, nprofile, hex, name@domain or CashAddr
  const identity = id.kind === 'nip05' ? await resolveNip05(id.name, id.domain)
    : id.kind === 'pubkey' ? id : null;
  if (!identity) return null;
  const r = await lookupIdentity(identity.pubkey, { relays: walletRelays, hints: identity.relays, cache });
  const claim = r.resolution.primary;
  switch (r.resolution.state) {
    case 'active':      return { address: claim!.cashaddr, verified: true, expiresAt: claim!.result!.binding!.expiresAt };
    case 'withdrawn':   throw new Error('This person removed that address. Ask them for a new one.');
    case 'expired':     throw new Error('Their address link expired.');
    case 'unavailable': throw new Error('Could not reach relays. Try again.');   // not "invalid"
    default:            return null;                                            // no verified address
  }
}
```

`cache` is any `{ get(pubkey), put(pubkey, event) }` store (see `memoryCache()`); it keeps the newest snapshots seen so a stale relay cannot roll the wallet back.

Show the verified address with its source (npub, name, "verified · valid until …"). Keep token-aware intent: if the claim is a `z…` address the receiver said it accepts CashTokens; a `q…` claim says nothing about tokens.

## B. "Link my address" — publish from the wallet

A wallet that holds both keys can create the binding without any UI round trips:

```ts
import { bindMessage, claimTag, createStatement, signMessage, upsertClaimTag, verifyBinding } from '@cachet/core';
import { fetchCurrentSnapshot, publishEvent } from '@cachet/discovery';
import { finalizeEvent } from 'nostr-tools/pure';

const statement = createStatement({ cashaddr: receiveAddress, nostrPubkey, ttlSeconds: 90 * 86400 });
const proof = { type: 'bch-nostr-bind/v1', statement, bch_signature: signMessage(addressPrivateKey, bindMessage(statement)) } as const;

const { latest } = await fetchCurrentSnapshot(nostrPubkey, relays);       // keep the user's other NIP-39 claims
const event = finalizeEvent({
  kind: 10011,
  created_at: Math.max(Math.floor(Date.now() / 1000), (latest?.created_at ?? 0) + 1),
  tags: upsertClaimTag(latest?.tags ?? [], claimTag(proof)),
  content: latest?.content ?? '',
}, nostrSecretKey);

if (!verifyBinding(event, { cashaddr: statement.cashaddr }).ok) throw new Error('self-check failed');
const results = await publishEvent(event, relays);
if (!results.some((r) => r.ok)) throw new Error('No relay accepted the binding');
```

Rules that matter:

- **Separate keys.** The Nostr key and the address key must differ (the verifier rejects equal x-coordinates). Deriving Nostr from its own path (NIP-06, `m/44'/1237'/…`) and BCH from `m/44'/145'/…` satisfies this.
- **Sign the exact text.** `bindMessage()` is three lines with no trailing newline. Do not pre-hash or trim; pass the exact 3-line text to Bitcoin Signed Message signing, including WalletConnect's `bch_signMessage`.
- **Withdraw** with `removeClaimTag(latest.tags, address)` and a newer `created_at`.

Over WalletConnect, a dapp asks for the same signature with `bch_signMessage({ message: bindMessage(statement), userPrompt })`. Cachet checks the returned signature recovers the selected address before using it.

## Paytaca today → this profile

Paytaca's chat module publishes `kind 30078`, `d=paytaca:bch-address`, signed by the Nostr key (`publishBchAddress`, `fetchPublishedBchAddress` in `src/store/nostr-chat/actions.js`). Three differences matter for payments:

| Today | With bch-nostr-bind/v1 |
|---|---|
| The address is asserted by the Nostr key; nothing proves the wallet controls it | The address key signs a statement naming the npub |
| If the event is removed or empty, the reader returns the cached address | Removal is `withdrawn`; the reader refuses to pay it |
| If signature verification fails, the reader returns the cached address | A broken newest snapshot is `invalid`; no fallback |

Migration that keeps old clients working:

1. **Publish both** for a release: keep `publishBchAddress` for old readers, add the kind 10011 claim above. Paytaca already derives the Nostr key from its own path, so separate keys come for free.
2. **Read new first**: `const r = await lookupIdentity(pubkey)`. Only when no kind 10011 snapshot exists (`!r.resolution.latest`), discovery may return `r.legacy` from a signed 30078 announcement. Show it as *"Announced by this npub — not verified"*, with a different visual state than verified. It never makes the resolution `active`, and is never returned after a 10011 withdrawal, even if the resulting state is `not_found`.
3. **Drop fallbacks** on removal or verification failure; `unavailable` (relays down) is the only case where a cached value may be shown, and it should be labelled as cached.
4. Later, stop publishing 30078 for addresses.

Drop-in replacement for `src/store/nostr-chat/actions.js`:

```js
import { bindMessage, claimTag, createStatement, signMessage, upsertClaimTag, verifyBinding } from '@cachet/core';
import { fetchCurrentSnapshot, lookupIdentity, memoryCache, publishEvent } from '@cachet/discovery';
import { finalizeEvent } from 'nostr-tools/pure';

const snapshotCache = memoryCache();

export async function publishBchAddress({ nostrSecretKey, nostrPubkey, bchAddress, bchPrivateKey, relays }) {
  const statement = createStatement({ cashaddr: bchAddress, nostrPubkey, ttlSeconds: 90 * 86400 });
  const proof = { type: 'bch-nostr-bind/v1', statement, bch_signature: signMessage(bchPrivateKey, bindMessage(statement)) };
  const { latest } = await fetchCurrentSnapshot(nostrPubkey, relays);
  const event = finalizeEvent({
    kind: 10011,
    created_at: Math.max(Math.floor(Date.now() / 1000), (latest?.created_at ?? 0) + 1),
    tags: upsertClaimTag(latest?.tags ?? [], claimTag(proof)),
    content: latest?.content ?? '',
  }, nostrSecretKey);
  if (!verifyBinding(event, { cashaddr: statement.cashaddr }).ok) throw new Error('Binding self-check failed');
  const acks = await publishEvent(event, relays);
  if (!acks.some((r) => r.ok)) throw new Error('No relay accepted kind 10011 binding');
  // Optional during transition: keep legacy kind 30078 write for older Paytaca clients.
}

export async function fetchPublishedBchAddress(pubkey, relays) {
  const r = await lookupIdentity(pubkey, { relays, cache: snapshotCache });
  switch (r.resolution.state) {
    case 'active':
      return { status: 'verified', address: r.resolution.primary.cashaddr, expiresAt: r.resolution.primary.result.binding.expiresAt };
    case 'withdrawn':
    case 'expired':
    case 'invalid':
      return { status: r.resolution.state, address: null }; // never fall back to cached or legacy 30078
    case 'unavailable':
      return { status: 'unavailable', address: null };
    default:
      return r.legacy
        ? { status: 'unverified_legacy', address: r.legacy.cashaddr } // show distinct "not verified" warning
        : { status: 'not_found', address: null };
  }
}
```

## Cashonize (#405)

Cashonize asked for a public spec plus another wallet implementing it before adopting a send-to-npub flow. This repository provides the spec (`docs/PROTOCOL.md`), shared vectors (`fixtures/`), a reference verifier, and a dapp that signs through Cashonize's existing `bch_signMessage` handler. The address book integration is feature A above.
