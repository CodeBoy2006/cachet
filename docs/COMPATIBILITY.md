# Compatibility & Verification

Cachet is verified across live BCH mainnet wallets, public Nostr relays, independent relying-party servers, and a 157-test automated suite.

## BCH wallets (mainnet)

| Wallet | Link via WalletConnect (`bch_signMessage`) | Link via manual BSM | Pay via BIP21 QR / URI | Pay via WalletConnect | Pay via WizardConnect | Protocol & integration notes |
|---|---|---|---|---|---|---|
| **Paytaca** | ✓ Verified | — | ✓ Verified | ✓ Verified | — | `wc2-bch-bcr` (`bch_getAddresses`, `bch_signMessage`, `bch_signTransaction`); legacy `kind 30078` announcements detected as unverified with 1-click upgrade |
| **Selene** | — | — | ✓ Verified | — | ✓ Verified | `@wizardconnect/react` xpub pairing; BIP44 `receive` + `change` gap-limit scan (`gapLimit = 20`, up to 200 addresses) |
| **Cashonize** | ✓ Verified | ✓ Verified | ✓ Verified | ✓ Verified | — | `wc2-bch-bcr` message & tx signing; native `q…` and token-aware `z…` CashTokens addresses (addresses Cashonize `#405`) |
| **Electron Cash** | — | ✓ Verified | ✓ Verified | — | — | Reference Bitcoin Signed Message (`Sign/Verify message`) implementation |
| **Zapit** | ✓ Verified (`wc2-bch-bcr`) | — | ✓ Verified | ✓ Verified (`wc2-bch-bcr`) | — | Shares the `wc2-bch-bcr` `bch:bitcoincash` namespace and extended-JSON wire format |
| **Sandbox key (built-in)** | ✓ Built-in | — | ✓ Receives | — | — | Real mainnet key in `localStorage` for 1-click wallet-free evaluation; prompts for WIF backup before funding |

WalletConnect (`wc2-bch-bcr`) covers both binding creation (`bch_signMessage`) and transaction checkout (`bch_signTransaction`). WizardConnect exposes HD extended public keys and transaction signing, powering direct balance discovery and checkout in Selene.

## Nostr signers, relays & live infrastructure

| Layer | Verified with | Exercised behavior |
|---|---|---|
| **NIP-07 browser extensions** | Alby, nos2x, Keys.band | `getPublicKey` and `signEvent` for `kind 10011` bindings, withdrawals, and `kind 27235` NIP-98 logins |
| **Redirect signer (`/sign`)** | Desktop & mobile browsers | Extension-free cross-origin NIP-98 approval; enforces return origin, `POST` method, and SHA-256 body commitment |
| **Public Nostr relays** | `nos.lol`, `relay.primal.net`, `relay.damus.io`, `nostr.mom`, `purplepag.es` | Multi-relay publish with ack timing, two-wave NIP-65 write-relay discovery, reverse `q…`/`z…` CashAddr lookup, anti-rollback snapshot cache |
| **Fulcrum WebSocket cluster** | `bch.imaginary.cash`, `electroncash.dk`, `bch.loping.net`, `fulcrum.greyh.at` | Fastest-handshake server racing, `scripthash` subscriptions for live `0-conf` → confirmed receipts, `ensureBroadcast` txid verification |
| **Relying parties (`apps/rp`)** | Fieldnote & Stall | Independent relay verification, cookie-bound atomic login challenges, live session termination and seller-checkout closure on withdrawal |

## Automated suite (`npm test` · 157 tests)

| Area | Coverage |
|---|---|
| **Bitcoin Signed Message** | `mainnet-js` / Electron Cash vectors, byte-exact signature reproduction, malleated ECDSA twin, `CompactSize` boundaries, UTF-8 payloads |
| **CashAddr & CashTokens** | `q…` and token-aware `z…` forms of one keypair, strict vs. normalized parsing, P2SH (`p…`) rejection |
| **9-check binding verifier** | Every failure code, `nostr-tools` `Symbol(verified)` cache-bypass rebuild, `d` / `n − d` x-coordinate key mirroring, strict RFC 8785 JCS canonicalization |
| **6-state snapshot resolver** | Newest replaceable snapshot wins, NIP-01 tie-breaking by lowest event ID, explicit withdrawal, zero fallback to stale valid claims, cache rollback protection, `unavailable` vs. `not_found` |
| **Relays & legacy migration** | In-memory mock relay fault injection (reject, timeout, `AUTH`, closed socket, stale copy), NIP-65 second-wave routing, Paytaca `kind 30078` unverified awareness & `10011` snapshot suppression |
| **Relying-party auth** | NIP-98 URL/method/body/key/cookie checks, isolated per-RP cookies, fresh verify-time relay resolution, expired challenge/binding handling, 5 concurrent replays → 1 atomic success, live re-check revocation |
| **Payments & coin selection** | Exact `bigint` BIP21 amounts, largest-first coin selection, 546-sat dust handling, typed `InsufficientFundsError` shortfalls, CashTokens UTXO exclusion, libauth extended-JSON serialization, Fulcrum `0-conf` → confirmed state transitions |

## Protocol safety notes

- **CashTokens UTXO protection**: `scanHdWallet` and `scanAddressWallet` filter out any UTXO carrying `token_data`, ensuring a BCH payment never burns CashTokens held on the same address.
- **WalletConnect string response metadata (Cashonize #399 / WalletConnect PR #7385)**: Older WalletConnect SDK builds may include string RPC responses such as `bch_signMessage` in TVF `txHashes`. Cachet is unaffected by design: binding signatures are public NIP-39 claims, and relying-party logins rely on fresh Nostr `kind 27235` challenges rather than `bch_signMessage`.
