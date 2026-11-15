# Widget Factory deck — outline

One idea per slide. Show, don't list.

1. **Problem.** People paste BCH addresses into chats. Nothing proves the address belongs to the person you think. Nostr profiles that "announce" an address can't prove it either.
2. **Cachet.** Your npub becomes a payable, verifiable BCH identity. Both keys sign one statement; it lives on relays; anyone verifies it. Screenshot: the identity card.
3. **Pay a person.** Profile page → QR or WizardConnect from Selene → payment shows up live. (Real mainnet transaction in the demo.)
4. **Sign in anywhere.** Fieldnote and Stall: two apps, two servers, one identity. Withdraw the link → both stop accepting it. Screenshot: Fieldnote's server log.
5. **Why it's safe.** The Lab: 12 adversarial cases — stolen address, replayed proof, mirrored key (d / n−d), edited event, cached-verification bypass, unverified 30078 — each fails a named check. 125+ tests, shared fixtures, offline CLI.
6. **For wallets.** Paytaca and Cashonize can resolve npub → verified address in ~20 lines; migration from Paytaca's unverified 30078 announcement keeps old clients working.
7. **Business.** Free protocol and SDK. Paid: hosted verification API with relay redundancy and webhooks for merchants and marketplaces (Stall), and white-label sign-in for creator platforms (Fieldnote). Wallets get "send to name" without running infrastructure.
8. **Built Nov 14–22.** No prior code. Links: demo, source, protocol spec.
