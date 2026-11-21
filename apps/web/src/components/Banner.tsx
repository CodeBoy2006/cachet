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
    title: 'An address in a profile proves nothing.',
    body: 'People paste BCH addresses into chats or put one in a Nostr profile. Neither shows that the Nostr author controls that wallet, and either can be swapped on the way.',
    callout: 'Anyone can copy your CashAddr into their own profile.',
  },
  {
    kicker: 'Cachet',
    title: 'Both keys sign one statement.',
    body: 'The BCH wallet signs a statement naming the npub. The Nostr key signs the kind 10011 event that carries it. Wallets and apps verify it from relays; no Cachet server is involved.',
    code: 'BCH wallet ──signs M──▶ statement {cashaddr, nostr_pubkey, expires_at}\nNostr key  ──signs───▶ kind 10011 ["i", "bch:<addr>", "<JCS proof>"]',
  },
  {
    kicker: 'Pay a person',
    title: 'Look up a person, check the proof, pay.',
    body: 'A profile page reruns every check in the browser, then offers a BIP21 QR, Paytaca over WalletConnect or Selene over WizardConnect. Fulcrum reports the payment when it reaches the mempool.',
    callout: 'The receipt appears at 0-conf, on the page you paid from.',
  },
  {
    kicker: 'Sign in',
    title: 'One link, two independent apps, one withdrawal.',
    body: 'Fieldnote (member notes) and Stall (seller checkout) run on separate origins and query relays themselves. Withdraw the link once and both refuse it on their next check.',
    callout: config.apps.length
      ? 'Try it: sign in, withdraw on your profile, then switch back to the app.'
      : 'Run the example apps locally to try cross-app sign-in.',
  },
  {
    kicker: 'Why it holds',
    title: 'Eleven attacks, each stopped by a named check.',
    body: 'A stolen address, a proof replayed under another npub, d / n−d key mirroring, edits after signing, a bypassed nostr-tools verification cache, and unsigned kind 30078 announcements.',
    callout: 'Test vectors, property-based tests and an offline CLI verifier.',
  },
  {
    kicker: 'For wallets',
    title: 'Resolve an npub to a verified CashAddr in a few lines.',
    body: 'Existing Paytaca kind 30078 announcements are shown as unverified, with a path to upgrade them to a dual-signed NIP-39 link.',
    code: `const r = await lookupIdentity(pubkey, { relays });\nif (r.resolution.state === 'active') {\n  const { cashaddr } = r.resolution.primary!;\n  // both keys signed for this address\n}`,
  },
  {
    kicker: 'Business',
    title: 'Open protocol and MIT SDK. Paid hosting for merchants.',
    body: 'Wallets and self-hosted apps use it for free. A paid tier would run a verification API with relay redundancy, revocation webhooks for marketplaces and white-label sign-in.',
    callout: 'Built Nov 14–22, 2026 for BCH BLAZE, with no prior codebase.',
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

      <Dialog open={deckOpen} onClose={() => setDeckOpen(false)} title="Cachet" width={560}>
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
                All {PITCH_SLIDES.length} slides
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
