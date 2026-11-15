# Cachet

Link a Bitcoin Cash address to a Nostr key. Both keys sign one statement, it lives on Nostr relays, and any wallet or app can verify it without asking a server.

Built for **BCH BLAZE 2026** (Paytaca decentralized identity bounty, mainnet track). All code written Nov 14–22, 2026; no prior codebase.

| | |
|---|---|
| Slides | _add link_ |
| Live demo | _add link_ |
| EMBER2026 address | `bitcoincash:zzq4hd7sk4x32sxnusd7ch82d5c35fnwcg3ytwteug` |

## Try it

1. Open the site. The card on the right is a real binding made and verified in your tab.
2. **Quick sandbox test** on the home page (or **Create** with your own wallet) → *Sign* → *Publish*. You get a profile page that anyone can verify.
3. On the profile, **Pay**: default `1,000 sats`, scan the QR with any BCH wallet, or *Pay with WizardConnect* from Selene. Incoming payments and supporter receipts update live via Fulcrum.
4. Open **Fieldnote** and **Stall** (two separate apps with their own origins). *Sign in with Cachet* to unlock member articles on Fieldnote and open verified BCH seller checkout on Stall; share your `?seller=npub…` storefront URL so any buyer can verify it live from relays.
5. Back on your profile, **Withdraw**. Stall's public `?seller=` storefront closes on refresh immediately, and pressing *Re-check link* in Fieldnote or Stall ends the active session.
6. **Lab**: twelve attacks (stolen address, replayed proof, mirrored key, cached-verification bypass, unverified 30078…) and the exact check each one fails.

## Run locally

Node 22+.

```bash
npm install
```

Everything offline, against a local relay (no public relays touched):

```bash
npm run dev:local
```

Against public relays:

```bash
npm run dev
```

Cachet: http://localhost:5173 · Fieldnote: http://localhost:5174 · Stall: http://localhost:5175

```bash
npm test                         # 128 tests: vectors, verifier, resolver, relays + legacy 30078, RP login/gating/gateway, payments
npm run typecheck
npm run verify -- fixtures/valid.json          # offline verifier
npm run verify -- --npub npub1…                # resolve from relays
```

Configuration: copy `apps/web/.env.example` to `apps/web/.env`. `VITE_WC_PROJECT_ID` (WalletConnect Cloud) enables wallet signing; without it people sign manually or use a sandbox key. `VITE_FEATURED_NPUB` puts a live identity on the home page.

## How it works

```
BCH wallet ──signs M──▶ statement {cashaddr, nostr_pubkey, network, issued_at, expires_at, nonce}
                              │
Nostr key ──signs──▶ kind 10011 event ["i", "bch:<cashaddr>", "<JCS proof>"] ──▶ relays (yours + defaults)
                                                                                  │
            wallets, apps, CLI ◀── newest snapshot by author, every check rerun locally
```

The full profile, checks and states are in [docs/PROTOCOL.md](docs/PROTOCOL.md). Wallet teams: [docs/WALLET_INTEGRATION.md](docs/WALLET_INTEGRATION.md).

| Package | Does | Never does |
|---|---|---|
| [`packages/core`](packages/core/src) | Statement, message, JCS, Bitcoin Signed Message, CashAddr, `verifyBinding`, `resolveSnapshots`, NIP-98 | network, keys, DOM |
| [`packages/discovery`](packages/discovery/src) | Per-relay queries with evidence, NIP-65, publish with acks, reverse lookup | sign anything |
| [`packages/signers`](packages/signers/src) | NIP-07, sandbox keys, WalletConnect `bch_signMessage`; re-verifies every signer result | talk to relays |
| [`packages/pay`](packages/pay/src) | BIP21, Fulcrum watcher, unsigned P2PKH payment for WizardConnect | hold keys |
| [`packages/react`](packages/react/src) | Identity card, check list, relay evidence, QR | |
| [`apps/web`](apps/web/src) | Create, profile and pay, lab, sign-in approval page | act as an identity server |
| [`apps/rp`](apps/rp) | Example relying party, run as Fieldnote and Stall | trust Cachet |
| [`tools/verify-cli`](tools/verify-cli/src) | Offline verification | |

Choices worth knowing:

- **NIP-39 kind 10011, not 30078.** NIP-78 keeps 30078 for app-private data; this is meant to be read by everyone.
- **Newest snapshot only.** A removed, expired or broken claim is never replaced by an older one that "still worked". Caches keep the newest snapshot so a stale relay cannot roll a reader back.
- **Separate keys enforced by x-coordinate**, which also catches `d` / `n−d`.
- **Every input is rebuilt** before verification; nostr-tools' per-object verification cache is never trusted.
- **Logins** use NIP-98 over the exact body plus a server nonce tied to the browser, consumed atomically. RPs keep their own sessions and re-check relays.

## Status

Verified here: everything in `npm test`, and the full create → sign in to two apps → withdraw → revoked flow in a browser against a local relay.
Not yet verified: real-wallet pairing (Cashonize, Paytaca, Zapit, Electron Cash), WizardConnect payment from Selene, publishing to public relays. Results go in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Deploy

Set frontend origin variables (`VITE_CACHET_URL`, `VITE_RP_A_URL`, `VITE_RP_B_URL`) at build time so cross-origin sign-in links point to your live domains:

- **Separate processes**: `apps/web` is static (`npm run build -w @cachet/web` → `apps/web/dist`); `apps/rp` runs one Node process per app (`npm run build -w @cachet/rp`, then `RP=a ORIGIN=https://fieldnote.example PORT=… npm run start:a -w @cachet/rp`).
- **Single-process multi-origin gateway**: build with matching `VITE_*` origins, then `WEB_ORIGIN=https://cachet.example RP_A_ORIGIN=https://fieldnote.example RP_B_ORIGIN=https://stall.example PORT=3000 npm start` routes all three origins by `Host` header on one Node port while keeping separate cookies, challenges, and caches per origin.

MIT. Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
