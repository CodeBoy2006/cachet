import { useState } from 'react';
import { CopyChip, Dialog, IconArrowUpRight, Qr, shortCashaddr } from '@cachet/react';
import { config } from '../config.ts';

const PITCH_SLIDES = [
  ['Problem', 'People paste BCH addresses into chats. Neither pasted text nor single-key Nostr profile announcements prove address ownership.'],
  ['Cachet', 'Your npub becomes a payable, verifiable BCH identity. Both keys sign one statement, published as NIP-39 kind 10011 on Nostr relays.'],
  ['Pay a person', 'Profile page → BIP21 QR or WizardConnect from Selene → live 0-conf mainnet receipt via Fulcrum.'],
  ['Sign in anywhere', 'Fieldnote (publishing) and Stall (commerce): two independent servers, one identity. Withdraw the link and both revoke access.'],
  ['Why it’s safe', '12 adversarial lab cases: stolen address, replay, d / n−d key mirror, tampered event, nostr-tools cache bypass, unverified 30078.'],
  ['For wallets', 'Paytaca & Cashonize resolve npub → verified CashAddr in ~20 lines via @cachet/core + @cachet/discovery, with legacy 30078 awareness.'],
  ['Business', 'Open protocol & SDK; hosted relay-redundant verification API, revocation webhooks for merchants, and white-label creator sign-in.'],
] as const;

/** BCH BLAZE 2026 requires slides, source and an EMBER2026 address at the top of the home page. */
export const Banner = () => {
  const { slides, repo, ember } = config.banner;
  const [deckOpen, setDeckOpen] = useState(false);
  const [emberOpen, setEmberOpen] = useState(false);

  return (
    <div className="banner">
      <div className="wrap">
        <span>BCH BLAZE 2026 · built Nov 14–22, no prior code</span>
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
          <span className="muted" title="Set VITE_REPO_URL at build time">
            Source
          </span>
        )}
        <span className="ember">
          EMBER2026
          {ember ? (
            <>
              <CopyChip value={ember} label={shortCashaddr(ember, 8, 6)} title="Copy CashTokens address" />
              <button type="button" className="banner__btn" onClick={() => setEmberOpen(true)} title="Show EMBER2026 QR code">
                QR
              </button>
            </>
          ) : (
            <span className="mono muted" title="Set VITE_EMBER_ADDRESS to a bitcoincash:z… address">
              z… pending env
            </span>
          )}
        </span>
      </div>

      <Dialog open={deckOpen} onClose={() => setDeckOpen(false)} title="Cachet — Widget Factory overview">
        <div style={{ display: 'grid', gap: 12 }}>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
            {PITCH_SLIDES.map(([title, body]) => (
              <li key={title}>
                <strong>{title}.</strong> <span className="soft">{body}</span>
              </li>
            ))}
          </ol>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Full deck link attaches via <span className="mono">VITE_SLIDES_URL</span> ·{' '}
            <a
              href="https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing"
              target="_blank"
              rel="noreferrer"
            >
              BLAZE Widget Factory template <IconArrowUpRight size={11} />
            </a>
          </p>
        </div>
      </Dialog>

      {ember && (
        <Dialog open={emberOpen} onClose={() => setEmberOpen(false)} title="EMBER2026 community vote">
          <div style={{ display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center' }}>
            <Qr value={ember} size={196} label="EMBER2026 CashTokens address" />
            <p className="soft" style={{ margin: 0, fontSize: 13.5 }}>
              Send <strong>EMBER2026</strong> CashTokens to vote for Cachet in Community Choice.
            </p>
            <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--ink-2)' }}>
              {ember}
            </code>
            <CopyChip value={ember} label="Copy CashTokens address" />
          </div>
        </Dialog>
      )}
    </div>
  );
};
