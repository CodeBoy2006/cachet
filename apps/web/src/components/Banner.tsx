import { useState } from 'react';
import { CopyChip, Dialog, IconArrowUpRight, Qr, shortCashaddr } from '@cachet/react';
import { config } from '../config.ts';

const PITCH_SLIDES = [
  ['Problem', 'People paste BCH addresses into chats. Neither the pasted text nor a single-key Nostr announcement proves who controls the address.'],
  ['Cachet', 'Your npub becomes a payable, verifiable BCH identity. Both keys sign one statement, published as a NIP-39 kind 10011 claim.'],
  ['Pay a person', 'Profile page → BIP21 QR or WizardConnect from Selene → the payment shows up live via Fulcrum.'],
  ['Sign in anywhere', 'Fieldnote and Stall: two independent servers, one identity. Withdraw the link and both stop accepting it.'],
  ['Why it holds', 'Twelve lab cases: stolen address, replay, d / n−d key mirror, tampered event, nostr-tools cache bypass, unverified 30078.'],
  ['For wallets', 'Paytaca and Cashonize resolve npub → verified CashAddr in about 20 lines with @cachet/core and @cachet/discovery.'],
  ['Business', 'Open protocol and SDK. Paid: hosted verification with relay redundancy, revocation webhooks, white-label sign-in.'],
] as const;

/** BCH BLAZE 2026 requires slides, source and an EMBER2026 address at the top of the home page. */
export const Banner = () => {
  const { slides, repo, ember } = config.banner;
  const [deckOpen, setDeckOpen] = useState(false);
  const [emberOpen, setEmberOpen] = useState(false);

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
            EMBER2026
            <span className="hide-sm">
              <CopyChip value={ember} label={shortCashaddr(ember, 6, 6)} title="Copy EMBER2026 CashTokens address" />
            </span>
            <button type="button" className="banner__btn" onClick={() => setEmberOpen(true)} title="Show EMBER2026 address and QR code">
              QR
            </button>
          </span>
        )}
      </div>

      <Dialog open={deckOpen} onClose={() => setDeckOpen(false)} title="Cachet in seven slides" width={520}>
        <ol className="deck">
          {PITCH_SLIDES.map(([title, body], i) => (
            <li key={title}>
              <span className="deck__n mono">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
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
