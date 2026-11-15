import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { npubEncode } from '@cachet/core';
import { CheckList, Dialog, IconArrowRight, IconArrowUpRight, IconBeaker, IconKey, IconLock, IconWallet, IdentityCard, Spinner, shortNpub } from '@cachet/react';
import { config } from '../config.ts';
import { SearchBox } from '../components/SearchBox.tsx';
import { useLookup } from '../lib/useLookup.ts';
import { makeExample, type Example } from '../lib/example.ts';
import { useSession } from '../lib/session.tsx';

const PayPanel = lazy(() => import('../components/PayPanel.tsx').then((m) => ({ default: m.PayPanel })));

const Featured = ({ id }: { id: string }) => {
  const { state } = useLookup(id);
  const [payOpen, setPayOpen] = useState(false);
  const result = state.status === 'done' ? state.result : undefined;
  const claim = result?.resolution.primary;
  const binding = claim?.result?.binding;
  const canPay = result?.resolution.state === 'active' && !!claim && binding?.network === 'mainnet';
  const payee = result?.profile?.displayName || result?.profile?.name || (result ? shortNpub(result.pubkey) : '');
  const asked = state.status === 'loading' ? state.relays.length + state.pending.length : result?.relays.length ?? 0;
  const seen = result?.resolution.snapshots[0]?.relays.filter((r) => r !== 'cache').length ?? 0;
  return (
    <>
      <IdentityCard
        state={state.status === 'loading' ? 'loading' : state.status === 'error' ? 'unavailable' : result?.resolution.state ?? 'loading'}
        pubkey={result?.pubkey ?? (state.status === 'loading' ? state.pubkey : undefined)}
        name={result?.profile?.displayName || result?.profile?.name}
        picture={result?.profile?.picture}
        cashaddr={claim?.cashaddr}
        tokenAware={binding?.tokenAware}
        expiresAt={binding?.expiresAt}
      />
      <div className="hero__caption">
        <span>{state.status === 'loading' ? `Asking ${asked} relays…` : result ? `Found on ${seen} of ${asked} relays, verified in your browser` : 'Relays did not answer'}</span>
        {result && (
          <span className="row" style={{ gap: 10 }}>
            {canPay && (
              <button type="button" className="c-btn c-btn--accent c-btn--sm" onClick={() => setPayOpen(true)}>
                <IconWallet size={14} /> Tip 1,000 sats
              </button>
            )}
            <Link href={`/p/${result.npub}`}>
              Profile <IconArrowRight size={14} />
            </Link>
          </span>
        )}
      </div>
      {canPay && claim && (
        <Dialog open={payOpen} onClose={() => setPayOpen(false)} title={`Pay ${payee}`}>
          <Suspense
            fallback={
              <div className="row muted" style={{ padding: '20px 0', justifyContent: 'center' }}>
                <Spinner /> Loading checkout…
              </div>
            }
          >
            <PayPanel cashaddr={claim.cashaddr} payee={payee} />
          </Suspense>
        </Dialog>
      )}
    </>
  );
};

const LocalExample = () => {
  const [ex, setEx] = useState<Example>();
  useEffect(() => {
    void makeExample().then(setEx);
  }, []);
  const b = ex?.result.binding;
  return (
    <>
      <IdentityCard
        state={ex ? (ex.result.ok ? 'active' : 'invalid') : 'loading'}
        pubkey={ex?.nostr.pubkey}
        name="Example identity"
        cashaddr={b?.cashaddr}
        expiresAt={b?.expiresAt}
      />
      {ex && (
        <div className="c-card hero__checks">
          <CheckList checks={ex.result.checks.filter((c) => ['event', 'identity', 'time', 'bch_signature', 'key_separation'].includes(c.id))} />
        </div>
      )}
      <div className="hero__caption">
        <span>Throwaway keys, signed and verified in this tab. Nothing published.</span>
        <Link href="/lab">
          Break it <IconArrowRight size={14} />
        </Link>
      </div>
    </>
  );
};

export const Home = () => {
  const { nostr, useQuickSandbox } = useSession();
  const [, navigate] = useLocation();
  const myNpub = nostr ? npubEncode(nostr.pubkey) : undefined;
  const payableTarget = config.featured ?? myNpub;

  const startQuickTest = () => {
    useQuickSandbox();
    navigate('/new');
  };

  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <h1>Link your Bitcoin Cash address to your Nostr key.</h1>
          <p className="lede">
            Both keys sign one statement. It lives on Nostr relays, so any wallet or app can check who an address belongs to, without asking
            us.
          </p>
          <div className="hero__actions">
            <Link href="/new" className="c-btn c-btn--lg">
              Create your link
            </Link>
            <button type="button" className="c-btn c-btn--lg c-btn--secondary" onClick={startQuickTest} title="No browser extension required">
              <IconKey size={16} /> Quick sandbox test
            </button>
            <Link href="/lab" className="c-btn c-btn--lg c-btn--ghost">
              See the checks
            </Link>
          </div>
          <SearchBox />
        </div>
        <div className="hero__card">{payableTarget ? <Featured id={payableTarget} /> : <LocalExample />}</div>
      </section>

      <section className="steps" aria-label="How it works">
        <div>
          <span className="n">01</span>
          <h3>Sign with both keys</h3>
          <p>Your BCH wallet signs a statement naming your npub. Your Nostr key signs the event that carries it. Neither key leaves its wallet.</p>
        </div>
        <div>
          <span className="n">02</span>
          <h3>Publish to relays</h3>
          <p>The proof is a NIP-39 claim in your kind 10011 profile, on relays you choose. Renewing or withdrawing is a new snapshot.</p>
        </div>
        <div>
          <span className="n">03</span>
          <h3>Verify anywhere</h3>
          <p>Wallets turn an npub into a payable address. Apps check relays themselves to sign you in. A CLI verifies a proof offline.</p>
        </div>
      </section>

      <section className="tiles" aria-label="Use it">
        {payableTarget ? (
          <Link href={`/p/${encodeURIComponent(payableTarget)}`} className="tile">
            <span className="tile__icon">
              <IconWallet />
            </span>
            <h3>Pay a person, not a string</h3>
            <p>Look up an npub, verify the BCH signature in your browser, and send 1,000 sats from Selene via WizardConnect or any wallet QR.</p>
            <span className="tile__go">
              {config.featured ? 'Tip 1,000 sats on mainnet' : 'Open your payable profile'} <IconArrowRight size={14} />
            </span>
          </Link>
        ) : (
          <button type="button" className="tile" onClick={startQuickTest} style={{ textAlign: 'left', cursor: 'pointer' }}>
            <span className="tile__icon">
              <IconWallet />
            </span>
            <h3>Pay a person, not a string</h3>
            <p>Spin up a live payable profile in two clicks — no extension needed — then pay it from Selene over WizardConnect or QR.</p>
            <span className="tile__go">
              Launch payable profile <IconArrowRight size={14} />
            </span>
          </button>
        )}
        <div className="tile">
          <span className="tile__icon">
            <IconLock />
          </span>
          <h3>Sign in &amp; sell without passwords</h3>
          <p>Fieldnote gates member articles; Stall locks seller payouts to your verified BCH address. Withdraw once and both revoke.</p>
          <span className="tile__links">
            {config.apps.map((a) => (
              <a key={a.id} className="c-btn c-btn--sm c-btn--secondary" href={a.url} target="_blank" rel="noreferrer">
                {a.name} <IconArrowUpRight size={13} />
              </a>
            ))}
          </span>
        </div>
        <Link href="/lab" className="tile">
          <span className="tile__icon">
            <IconBeaker />
          </span>
          <h3>Try to break it</h3>
          <p>Swap the address, replay the proof under another npub, mirror a key (d / n−d). Each attempt fails a named check.</p>
          <span className="tile__go">
            Open the lab <IconArrowRight size={14} />
          </span>
        </Link>
      </section>
    </div>
  );
};
