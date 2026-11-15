import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { npubEncode, type BindingState } from '@cachet/core';
import {
  CheckList,
  Dialog,
  IconAlert,
  IconArrowRight,
  IconArrowUpRight,
  IconBeaker,
  IconCheck,
  IconLock,
  IconRefresh,
  IconUndo,
  IconWallet,
  IconZap,
  IdentityCard,
  Spinner,
  formatDate,
  shortNpub,
} from '@cachet/react';
import { config } from '../config.ts';
import { SearchBox } from '../components/SearchBox.tsx';
import { useLookup } from '../lib/useLookup.ts';
import { makeExample, type Example } from '../lib/example.ts';
import { useSession } from '../lib/session.tsx';

const PayPanel = lazy(() => import('../components/PayPanel.tsx').then((m) => ({ default: m.PayPanel })));

const CAPTIONS: Record<Exclude<BindingState, 'active'>, string> = {
  withdrawn: 'The owner withdrew this link.',
  expired: 'This link has expired.',
  invalid: 'The published proof does not verify.',
  not_found: 'No link on the relays checked.',
  unavailable: 'Relays did not answer.',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Featured = ({ id, own }: { id: string; own: boolean }) => {
  const { state } = useLookup(id);
  const [payOpen, setPayOpen] = useState(false);
  const result = state.status === 'done' ? state.result : undefined;
  const resolution = result?.resolution;
  const claim = resolution?.primary;
  const binding = claim?.result?.binding;
  const canPay = !own && resolution?.state === 'active' && !!claim && binding?.network === 'mainnet';
  const payee = result?.profile?.displayName || result?.profile?.name || (result ? shortNpub(result.pubkey) : '');
  const asked = state.status === 'loading' ? state.relays.length + state.pending.length : (result?.relays.length ?? 0);
  const seen = resolution?.snapshots[0]?.relays.filter((r) => r !== 'cache').length ?? 0;

  // Your own key without a link yet: show what one looks like instead of an empty card.
  if (own && resolution?.state === 'not_found') return <LocalExample />;

  const caption =
    state.status === 'loading' || state.status === 'idle'
      ? `Asking ${asked || config.relays.length} relays…`
      : state.status === 'error'
        ? state.message
        : resolution!.state === 'active'
          ? `On ${seen} of ${asked} relays · verified in this browser`
          : own && resolution!.state === 'withdrawn'
            ? 'You withdrew this link.'
            : CAPTIONS[resolution!.state];

  return (
    <>
      <IdentityCard
        state={state.status === 'error' ? 'unavailable' : (resolution?.state ?? 'loading')}
        pubkey={result?.pubkey ?? (state.status === 'loading' ? state.pubkey : undefined)}
        name={result?.profile?.displayName || result?.profile?.name}
        picture={result?.profile?.picture}
        cashaddr={claim?.cashaddr}
        tokenAware={binding?.tokenAware}
        expiresAt={binding?.expiresAt}
      />
      <div className="hero__caption">
        <span>{caption}</span>
        {result && (
          <span className="hero__caption-actions">
            {canPay && (
              <button type="button" className="c-btn c-btn--accent c-btn--sm" onClick={() => setPayOpen(true)}>
                <IconWallet size={14} /> Tip 1,000 sats
              </button>
            )}
            <Link href={`/p/${result.npub}`} className="hero__link">
              {own ? 'Your profile' : 'Profile'} <IconArrowRight size={14} />
            </Link>
          </span>
        )}
      </div>
      {canPay && claim && (
        <Dialog open={payOpen} onClose={() => setPayOpen(false)} title={`Pay ${payee}`} width={520}>
          <Suspense
            fallback={
              <div className="row muted" style={{ padding: '24px 0', justifyContent: 'center' }}>
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

const EXAMPLE_CHECKS = ['event', 'identity', 'time', 'bch_signature', 'key_separation'];
type MintStage = 'nostr' | 'bch' | 'sealed';

const LocalExample = () => {
  const [ex, setEx] = useState<Example>();
  const [stage, setStage] = useState<MintStage>('nostr');
  const [tampered, setTampered] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const runMintSequence = useCallback(
    (next: Example) => {
      clearTimers();
      setTampered(false);
      setEx(next);
      if (prefersReducedMotion()) {
        setStage('sealed');
        return;
      }
      setStage('nostr');
      timers.current.push(
        setTimeout(() => setStage('bch'), 290),
        setTimeout(() => setStage('sealed'), 660),
      );
    },
    [clearTimers],
  );

  useEffect(() => {
    let live = true;
    void makeExample().then((e) => live && runMintSequence(e));
    return () => {
      live = false;
      clearTimers();
    };
  }, [runMintSequence, clearTimers]);

  const remint = () => {
    void makeExample().then(runMintSequence);
  };

  const b = ex?.result.binding;
  const activeResult = tampered ? ex?.forged.result : ex?.result;
  const cardState = !ex ? 'loading' : tampered ? 'invalid' : stage === 'sealed' ? (ex.result.ok ? 'active' : 'invalid') : 'draft';
  const shownAddr = !ex || stage === 'nostr' ? undefined : tampered ? ex.forged.cashaddr : b?.cashaddr;
  const checkKey = !ex ? 'init' : `${ex.event.id}-${tampered ? 'tampered' : stage}`;

  const foot =
    !ex ? undefined : tampered ? (
      <>
        <span className="c-pill c-pill--invalid">Invalid</span>
        <span className="hero__tamper-note">Fake BCH address rejected · missing wallet signature</span>
      </>
    ) : stage === 'nostr' ? (
      <span className="hero__stage-line">
        <span className="c-dot" style={{ background: 'var(--dot-nostr)' }} /> 1/2 Nostr key ready · signing BCH statement…
      </span>
    ) : stage === 'bch' ? (
      <span className="idcard-foot-signed">
        <IconCheck size={13} strokeWidth={2.2} /> 2/2 BCH statement signed · sealing proof…
      </span>
    ) : (
      <>
        <span className="c-pill c-pill--active">Verified</span>
        {b?.expiresAt && <span>Valid until {formatDate(b.expiresAt)}</span>}
      </>
    );

  return (
    <>
      <IdentityCard
        key={ex?.event.id ?? 'init'}
        state={cardState}
        bchSigned={!tampered && stage === 'bch'}
        pubkey={ex?.nostr.pubkey}
        name="Example identity"
        cashaddr={shownAddr}
        expiresAt={b?.expiresAt}
        emptyBch="Signing statement…"
        foot={foot}
      />
      <div className="c-card hero__checks" data-tampered={tampered || undefined}>
        {ex && (stage === 'sealed' || tampered) && activeResult ? (
          <CheckList key={checkKey} checks={activeResult.checks.filter((c) => EXAMPLE_CHECKS.includes(c.id))} stagger={tampered ? 35 : 55} />
        ) : (
          <div className="hero__checks-skel" aria-hidden>
            {EXAMPLE_CHECKS.map((c) => (
              <span key={c} className="c-skel" />
            ))}
          </div>
        )}
      </div>
      <div className="hero__caption">
        <span>{tampered ? 'Nostr event is valid, but BCH check catches the swapped address.' : 'Live dual-key proof, signed and verified in this tab.'}</span>
        <span className="hero__caption-actions">
          {ex && stage === 'sealed' && (
            <button
              type="button"
              className={`c-btn c-btn--sm hero__tamper${tampered ? ' c-btn--secondary' : ' c-btn--ghost'}`}
              onClick={() => setTampered((t) => !t)}
              title={tampered ? 'Restore honest proof' : 'Simulate swapping in an unowned BCH address'}
            >
              {tampered ? (
                <>
                  <IconUndo size={13} /> Restore
                </>
              ) : (
                <>
                  <IconAlert size={13} /> Tamper address
                </>
              )}
            </button>
          )}
          <button type="button" className="c-btn c-btn--ghost c-btn--sm hero__remint" onClick={remint} title="Generate fresh keys and re-verify">
            <IconRefresh size={13} /> New keys
          </button>
          <Link href="/lab" className="hero__link">
            12 attacks <IconArrowRight size={14} />
          </Link>
        </span>
      </div>
    </>
  );
};

export const Home = () => {
  const { nostr, startSandbox } = useSession();
  const [, navigate] = useLocation();
  const myNpub = nostr ? npubEncode(nostr.pubkey) : undefined;
  const payableTarget = config.featured ?? myNpub;
  const own = !config.featured && !!myNpub;

  const startQuickTest = () => {
    startSandbox();
    navigate('/new?sandbox=1');
  };

  return (
    <div className="wrap page">
      <section className="hero">
        <div className="hero__copy">
          <div className="hero__eyebrow">
            <span className="hero__dots" aria-hidden>
              <span className="c-dot" style={{ background: 'var(--dot-nostr)' }} />
              <span className="c-dot" style={{ background: 'var(--dot-bch)' }} />
            </span>
            NIP-39 · Dual-signed BCH identity
          </div>
          <h1>Link your Bitcoin Cash address to your Nostr key.</h1>
          <p className="lede">
            Both keys sign one statement. It lives on Nostr relays, so any wallet or app can check who an address belongs to without asking us.
          </p>
          <div className="hero__actions">
            <Link href="/new" className="c-btn c-btn--lg">
              Create your link
            </Link>
            <button type="button" className="c-btn c-btn--lg c-btn--secondary hero__sandbox-btn" onClick={startQuickTest}>
              <IconZap size={16} /> Instant sandbox demo
            </button>
          </div>
          <SearchBox />
        </div>
        <div className="hero__card">{payableTarget ? <Featured key={payableTarget} id={payableTarget} own={own} /> : <LocalExample />}</div>
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
            <p>Look up an npub, check the BCH signature in your browser, then pay by QR or from Selene over WizardConnect.</p>
            <span className="tile__go">
              {config.featured ? 'Tip 1,000 sats on mainnet' : 'Open your profile'} <IconArrowRight size={14} />
            </span>
          </Link>
        ) : (
          <button type="button" className="tile" onClick={startQuickTest}>
            <span className="tile__icon">
              <IconWallet />
            </span>
            <h3>Pay a person, not a string</h3>
            <p>Make a payable profile with sandbox keys, then pay it by QR or from Selene over WizardConnect.</p>
            <span className="tile__go">
              Make a profile in one click <IconArrowRight size={14} />
            </span>
          </button>
        )}
        <div className="tile">
          <span className="tile__icon">
            <IconLock />
          </span>
          <h3>Sign in without passwords</h3>
          <p>Fieldnote unlocks member notes. Stall pays sellers at their verified address. Withdraw the link once and both stop accepting it.</p>
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
