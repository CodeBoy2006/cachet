# Compatibility

Automated tests and real-wallet checks are reported separately. A mock passing is not a wallet working.

## Automated (run `npm test`)

| Area | Covered by |
|---|---|
| Bitcoin Signed Message hashing and recovery | mainnet-js / Electron Cash vectors, byte-exact signature reproduction, malleated twin, CompactSize boundaries, UTF-8 |
| CashAddr | q/z forms of one key, strict vs lenient parsing, P2SH rejected |
| Binding verifier | every failure code, nostr-tools cache bypass, d / n−d key reuse, canonical JSON |
| Snapshot resolution | newest wins, tie by id, withdrawal, no fallback, rollback via cache, unavailable vs not found |
| Relays & legacy | in-memory relay: reject, timeout, AUTH required, closed socket, stale copy, NIP-65 second wave, Paytaca `kind 30078` unverified awareness & snapshot suppression |
| Relying party | NIP-98 URL/method/body/key/session checks, isolated RP cookies, fresh verify-time resolution, expired challenge/binding, 5 concurrent replays → 1 success, re-check revokes, gated notes & seller checkout |
| Payments | BIP21 amounts without floats, coin selection, dust change, typed shortfall for insufficient funds, token UTXOs never selected, extended-JSON `wc2-bch-bcr` / WizardConnect serialization, Electrum handshake/broadcast/0-conf→confirmed watcher |

## Manual, in a browser (local relay)

Done on 2026-11-14 with sandbox keys: create → profile → sign in to Fieldnote and Stall via Cachet redirect → withdraw → Fieldnote re-check ends the session.

## Real wallets — to be filled in during the event

| Wallet | `bch_signMessage` over WalletConnect | Manual sign message | Pays BIP21 QR | WalletConnect pay | WizardConnect pay | Notes |
|---|---|---|---|---|---|---|
| Paytaca | not yet tested | — | not yet tested | not yet tested | — | `wc2-bch-bcr` (`bch_signMessage` + `bch_signTransaction`) |
| Cashonize (web) | not yet tested | not yet tested | not yet tested | not yet tested | — | Source handles `bch_signMessage` & `bch_signTransaction` |
| Zapit | not yet tested | — | not yet tested | not yet tested | — | |
| Electron Cash | — | not yet tested | not yet tested | — | — | Reference BSM implementation |
| Selene | — | — | not yet tested | — | not yet tested | WizardConnect wallet |
| nos2x / Alby (NIP-07) | — | — | — | — | — | Nostr side, not yet tested |

Known upstream issue: Cashonize #399 — the WalletConnect SDK may publish string responses, including `bch_signMessage` results, in plaintext TVF `txHashes` (fix in WalletConnect PR #7385). Binding signatures are public anyway; logins never rely on them.
