import { useEffect, useState } from 'react';
import { CopyChip, Dialog, IconArrowUpRight, IconChevronLeft, IconChevronRight, Qr, shortCashaddr } from '@cachet/react';
import { config } from '../config.ts';

interface Slide {
  kicker: string;
  title: string;
  body: string;
  code?: string;
  callout?: string;
}

const PITCH_SLIDES: readonly Slide[] = [
  {
    kicker: 'Problem',
    title: 'Pasted addresses and single-key announcements prove nothing.',
    body: 'People paste BCH addresses into chats, or announce an address in a Nostr profile. Neither proves the Nostr author actually controls that BCH wallet.',
    callout: 'Anyone can copy your CashAddr into their profile—or swap yours in transit.',
  },
  {
    kicker: 'Cachet',
    title: 'Your npub becomes a payable, verifiable BCH identity.',
    body: 'Both keys sign one canonical statement. It lives on Nostr relays as a public NIP-39 kind 10011 claim—any wallet or app verifies it locally with zero Cachet server in the loop.',
    code: 'BCH wallet ──signs M──▶ statement {cashaddr, nostr_pubkey, expires_at}\nNostr key  ──signs───▶ kind 10011 ["i", "bch:<addr>", "<JCS proof>"]',
  },
  {
    kicker: 'Pay a person',
    title: 'Look up a person, verify in-browser, pay with instant 0-conf.',
    body: 'Every profile page re-runs all cryptographic checks in your tab, renders a BIP21 QR or builds an unsigned P2PKH transaction for Selene via WizardConnect, and watches Fulcrum live.',
    callout: 'Mainnet 0-conf receipts lock in live within a second.',
  },
  {
    kicker: 'Sign in anywhere',
    title: 'One identity across independent servers—with instant revocation.',
    body: 'Fieldnote (member articles) and Stall (verified seller checkout) run on separate origins and query relays themselves. Withdraw your link once and both immediately stop accepting it.',
    callout: 'Try it live: Sign in → Withdraw on Profile → switch back to Fieldnote or Stall.',
  },
  {
    kicker: 'Why it holds',
    title: 'Twelve adversarial vectors, each caught by a named invariant.',
    body: 'Stolen address, cross-npub replay, d / n−d x-coordinate key mirroring, post-sign mutation, nostr-tools Symbol(verified) cache bypass, and unverified kind 30078 spoofing.',
    callout: '130+ automated tests · property-based checks · standalone offline CLI.',
  },
  {
    kicker: 'For wallets',
    title: 'Paytaca & Cashonize can resolve npub → verified CashAddr in ~12 lines.',
    body: 'Legacy Paytaca kind 30078 announcements are surfaced safely as unverified awareness, with a one-click upgrade path to dual-signed NIP-39.',
    code: `const res = await lookupIdentity(npub, { relays });\nif (res.resolution.state === 'active') {\n  const { cashaddr } = res.resolution.primary!;\n  // Dual-key verified: safe to pay\n}`,
  },
  {
    kicker: 'Business',
    title: 'Open protocol & MIT SDK. Hosted infrastructure for merchants.',
    body: 'Free forever for wallets and self-hosted apps. Paid tier: high-availability verification API with relay redundancy, instant revocation webhooks for marketplaces, and white-label sign-in.',
    callout: 'Built Nov 14–22, 2026 for BCH BLAZE · zero prior codebase.',
  },
];

/** BCH BLAZE 2026 requires slides, source and an EMBER2026 address at the top of the home page. */
export const Banner = () => {
  const { slides, repo, ember } = config.banner;
  const [deckOpen, setDeckOpen] = useState(false);
  const [emberOpen, setEmberOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [allView, setAllView] = useState(false);

  useEffect(() => {
    if (!deckOpen || allView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % PITCH_SLIDES.length);
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + PITCH_SLIDES.length) % PITCH_SLIDES.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deckOpen, allView]);

  const current = PITCH_SLIDES[idx]!;

  return (
    <div className="banner">
      <div className="wrap">
        <span className="banner__event">
          BCH BLAZE 2026<span className="hide-sm"> · built Nov 14–22, no prior code</span>
        </span>
        <span className="banner__links">
          {slides ? (
            <a href={slides} target="_blank" rel="noreferrer">
              Slides <IconArrowUpRight size={12} />
            </a>
          ) : (
            <button type="button" className="banner__btn" onClick={() => setDeckOpen(true)}>
              Slides
            </button>
          )}
          {repo ? (
            <a href={repo} target="_blank" rel="noreferrer">
              Source <IconArrowUpRight size={12} />
            </a>
          ) : (
            import.meta.env.DEV && (
              <span className="muted" title="Set VITE_REPO_URL at build time">
                Source
              </span>
            )
          )}
        </span>
        {ember && (
          <span className="ember">
            <span className="ember__badge">
              <span className="ember__dot" aria-hidden />
              EMBER2026
            </span>
            <span className="hide-sm">
              <CopyChip value={ember} label={shortCashaddr(ember, 6, 6)} title="Copy EMBER2026 CashTokens address" />
            </span>
            <button type="button" className="banner__btn ember__qr-btn" onClick={() => setEmberOpen(true)} title="Show EMBER2026 address and QR code">
              Vote QR
            </button>
          </span>
        )}
      </div>

      <Dialog open={deckOpen} onClose={() => setDeckOpen(false)} title="Cachet — Pitch overview" width={560}>
        {allView ? (
          <div className="deck-wrap">
            <ol className="deck">
              {PITCH_SLIDES.map((s, i) => (
                <li key={s.kicker}>
                  <span className="deck__n mono">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{s.kicker}</strong>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="deck-foot">
              <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setAllView(false)}>
                Slide view
              </button>
            </div>
          </div>
        ) : (
          <div className="slide-deck">
            <div className="slide-deck__dots" role="tablist" aria-label="Slides">
              {PITCH_SLIDES.map((s, i) => (
                <button
                  key={s.kicker}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  className="slide-deck__dot mono"
                  onClick={() => setIdx(i)}
                >
                  {String(i + 1).padStart(2, '0')}
                </button>
              ))}
            </div>
            <div className="slide-card" key={current.kicker}>
              <div className="slide-card__kicker mono">
                {String(idx + 1).padStart(2, '0')} / {String(PITCH_SLIDES.length).padStart(2, '0')} · {current.kicker}
              </div>
              <h3 className="slide-card__title">{current.title}</h3>
              <p className="slide-card__body">{current.body}</p>
              {current.code && <pre className="c-code slide-card__code">{current.code}</pre>}
              {current.callout && <div className="slide-card__callout">{current.callout}</div>}
            </div>
            <div className="deck-foot">
              <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setAllView(true)}>
                All 7 slides
              </button>
              <div className="slide-deck__nav">
                <button
                  type="button"
                  className="c-btn c-btn--secondary c-btn--sm"
                  onClick={() => setIdx((i) => (i - 1 + PITCH_SLIDES.length) % PITCH_SLIDES.length)}
                  aria-label="Previous slide"
                >
                  <IconChevronLeft size={14} /> Prev
                </button>
                <button
                  type="button"
                  className="c-btn c-btn--sm"
                  onClick={() => setIdx((i) => (i + 1) % PITCH_SLIDES.length)}
                  aria-label="Next slide"
                >
                  Next <IconChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {ember && (
        <Dialog open={emberOpen} onClose={() => setEmberOpen(false)} title="EMBER2026 community vote">
          <div className="ember-dialog">
            <Qr value={ember} size={196} label="EMBER2026 CashTokens address" />
            <p className="soft">
              Send <strong>EMBER2026</strong> CashTokens to this address to vote for Cachet in Community Choice.
            </p>
            <code className="mono">{ember}</code>
            <CopyChip value={ember} label="Copy address" />
          </div>
        </Dialog>
      )}
    </div>
  );
};
