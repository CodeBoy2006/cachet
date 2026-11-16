# Cachet — film (≈ 60 s)

A real-time web film. Every frame is rendered from `t` (no video files): Three.js lights a sheet of cotton paper, a 2D "press" prints vector ink onto it, and the score is synthesised offline with Web Audio so picture and sound share one clock.

## Brainstorm

### Art direction (8)
1. **Proof on paper** — the film is a printed proof on cotton stock: letterpress ink, blind deboss, one emerald foil stamp. Light is the narrative. *(chosen)*
2. **Elements, Prop. I** — Byrne's 1847 Euclid: two circles, each through the other's centre, build everything. Flat primaries swapped for Cachet's violet / green / emerald. *(folded into 1 as the construction scene)*
3. **Banknote intaglio** — guilloche engraving, security microprint, a plate pressed into a note.
4. **Wax and signet** — two signet rings pressed into one seal on a letter (the literal "cachet").
5. **Ikeda data score** — black/white, hard cuts on clicks, hashes as barcodes. Precise but cold, hard to follow.
6. **Two oscillators** — two detuned tones beat against each other until both keys sign and they lock into a fifth. *(used as the score's spine)*
7. **One continuous take** — the whole film is a single camera move across one sheet; nothing is cut away, everything stays printed. *(used: the finale pulls back over the whole sheet)*
8. **Diptych** — left half Nostr, right half BCH; the halves slide together and the overlap tells the truth.

### Transitions (8)
1. **Text curls into a ring** — the BCH address bends into the BCH ring; the npub into the Nostr ring. *(used)*
2. **Statement collapses to its hash** — six lines of signed text squeeze into the binding ID. *(used)*
3. **Vesica iris** — screens change through a lens-shaped wipe, the brand mark as aperture. *(used)*
4. **Drop onto the seal** — the metal card falls from above and lands on the foil mark. *(used)*
5. **Light as a cut** — room light off / on instead of fades; cool light for attacks. *(used)*
6. **Pull back to the whole page** — macro → page → entire sheet. *(used: open and finale)*
7. **Match cut on circles** — QR finder → avatar → ring.
8. **Ink lift** — printed ink fades out of the fibres when a chapter is done. *(used)*

### Editing (6)
1. Cuts and stamps land on the 96 BPM grid (1 bar = 2.5 s, 24 bars). *(used)*
2. A breath of silence before the lock. *(used)*
3. Checks tick on 16th notes. *(used)*
4. Stamps ("signature_invalid") hit on the beat, red is reserved for rejection. *(used)*
5. Real product screens as prints on the desk, never as a screen recording. *(used)*
6. Hand-held drift never; slow dolly, true perspective, shallow focus for the macro. *(used)*

## Shot list

| Time | Bar | Beat | On screen | Sound |
|---|---|---|---|---|
| 0:00 | 1 | **A string.** Dark. A slit of light; a BCH address types itself in macro. | drone, key ticks |
| 0:03 | 2 | Pull back. *Whose is this?* | bell |
| 0:05 | 3 | Three people claim it. *Anyone can claim it.* | pencil |
| 0:07 | 3 | The address curls into a ring; the npub into another. | swell |
| 0:09 | 4–5 | **Two keys.** NOSTR KEY / BCH WALLET. | two tones beating |
| 0:11 | 5–6 | The real signed statement. *Both keys sign one statement.* Each ring signs. | tock, typing |
| 0:16 | 7–8 | Statement collapses to its hash; rings close in; compass lines. | riser, beat slows |
| 0:20 | 9 | **Lock.** Emerald foil, deboss, lights up. | silence → thunk, fifth |
| 0:22 | 9–10 | The metal card drops onto the seal. | clack |
| 0:23 | 10 | *Lives on Nostr relays.* Lines to six relays. | pings |
| 0:25 | 11–12 | *Anyone can verify it. No server to trust.* 9 real checks → ∎ | 16th ticks |
| 0:30 | 13–14 | *Pay a person, not a string.* Real pay panel. | groove |
| 0:34 | 14–16 | *One identity. Every app.* Fieldnote and Stall sign in through a vesica wipe. | clicks, chimes |
| 0:39 | 16–17 | *Withdraw once. Every app lets go.* Stamp; both apps sign out; `binding_inactive`. | stamp, fall |
| 0:43 | 18–20 | Cool light. *Steal an address* · *Replay the proof* · *Mirror the key* → real failure codes. | stamps |
| 0:50 | 21 | The Lab's 12 cases stamp in. *Only the real one passes.* | 16th stamps |
| 0:53 | 22 | Pull back over the whole sheet; ink lifts. | bloom |
| 0:55 | 23–24 | **cachet** — *Both keys sign. Anyone verifies.* Lights out. | final fifth |

All data on screen is real: the npub, address, signed statement, signatures, binding ID and check list come from a binding published to the local relay by `tools/capture.mjs`, which also captured the Fieldnote / Stall / Cachet screens.
