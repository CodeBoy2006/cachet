import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CHECK_LABELS, npubEncode, verifyBinding, type BindingState, type Check, type CheckId } from '@cachet/core';
import {
  Dialog,
  IconAlert,
  IconArrowRight,
  IconArrowUpRight,
  IconBeaker,
  IconLock,
  IconRefresh,
  IconUndo,
  IconWallet,
  IconZap,
  Spinner,
  StatePill,
  shortCashaddr,
  shortNpub,
} from '@cachet/react';
import { config } from '../config.ts';
import { SearchBox } from '../components/SearchBox.tsx';
import { Cachet, CachetBack, Ledger, ZONE_OF, useReveal, type CachetStage, type CachetZone } from '../components/Cachet.tsx';
import { useLookup } from '../lib/useLookup.ts';
import { makeExample, type Example } from '../lib/example.ts';
import { prefersReducedMotion } from '../lib/useScramble.ts';
import { useSession } from '../lib/session.tsx';

const PayPanel = lazy(() => import('../components/PayPanel.tsx').then((m) => ({ default: m.PayPanel })));

const CAPTIONS: Record<Exclude<BindingState, 'active'>, string> = {
  withdrawn: 'The owner withdrew this link.',
  expired: 'This link has expired.',
  invalid: 'The published proof does not verify.',
  not_found: 'No link on the relays checked.',
  unavailable: 'Relays did not answer.',
};

const OVERPRINT: Partial<Record<BindingState, string>> = { invalid: 'VOID', withdrawn: 'WITHDRAWN', expired: 'EXPIRED' };

const HERO_CHECKS: CheckId[] = ['event', 'identity', 'time', 'bch_signature', 'key_separation'];
const PENDING: Check[] = HERO_CHECKS.map((id) => ({ id, label: CHECK_LABELS[id], status: 'skip' }));
const heroRows = (checks?: Check[]) => (checks ? checks.filter((c) => HERO_CHECKS.includes(c.id)) : PENDING);

const fmtMs = (ms: number) => (ms < 0.1 ? '<0.1 ms' : ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`);

const IconFlip = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 2v12" strokeDasharray="1.4 1.8" />
    <path d="M5.75 4.5 2.25 11.5h3.5Z" />
    <path d="M10.25 4.5l3.5 7h-3.5Z" />
  </svg>
);

const Featured = ({ id, own }: { id: string; own: boolean }) => {
  const { state } = useLookup(id);
  const [payOpen, setPayOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [hover, setHover] = useState<CachetZone>();
  const result = state.status === 'done' ? state.result : undefined;
  const resolution = result?.resolution;
  const claim = resolution?.primary;
  const res = claim?.result;
  const binding = res?.binding;
  const rows = heroRows(res?.checks);
  const reveal = useReveal(rows.length, res ? `${res.event?.id ?? ''}-${resolution?.state}` : undefined, 150);
  const canPay = !own && resolution?.state === 'active' && !!claim && binding?.network === 'mainnet';
  const payee = result?.profile?.displayName || result?.profile?.name || (result ? shortNpub(result.pubkey) : '');
  const asked = state.status === 'loading' ? state.relays.length + state.pending.length : (result?.relays.length ?? 0);
  const seen = resolution?.snapshots[0]?.relays.filter((r) => r !== 'cache').length ?? 0;

  // Your own key without a link yet: show what one looks like instead of an empty card.
  if (own && resolution?.state === 'not_found') return <LocalExample />;

  const bindingState: BindingState | undefined = state.status === 'error' ? 'unavailable' : resolution?.state;
  const pubkey = result?.pubkey ?? (state.status === 'loading' ? state.pubkey : undefined);
  const settled = !!bindingState && (!res || reveal.done);
  const stage: CachetStage = settled ? 'sealed' : res ? 'nostr' : pubkey ? 'keys' : 'empty';
  const verdict = bindingState === 'active' ? 'valid' : bindingState === 'invalid' ? 'void' : 'muted';
  const current = !reveal.done && reveal.shown > 0 ? ZONE_OF[rows[reveal.shown - 1]!.id] : undefined;
  const passed = rows.slice(0, reveal.shown).filter((c) => c.status === 'pass').length;

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
      <Cachet
        stage={stage}
        verdict={verdict}
        pubkey={pubkey}
        name={result?.profile?.displayName || result?.profile?.name}
        picture={result?.profile?.picture}
        cashaddr={claim?.cashaddr}
        tokenAware={binding?.tokenAware}
        serial={binding?.bindingId}
        bchKey={binding?.bchPublicKey}
        expiresAt={binding?.expiresAt}
        focus={hover ?? current}
        overprint={bindingState ? OVERPRINT[bindingState] : undefined}
        status={settled && bindingState ? <StatePill state={bindingState} /> : <StatePill state="loading" />}
        flipped={flipped && !!binding}
        back={
          binding && res?.event ? (
            <CachetBack message={binding.message} bchSig={binding.bchSignature} eventId={binding.eventId} nostrSig={res.event.sig} />
          ) : undefined
        }
      />
      {res && (
        <Ledger
          checks={rows}
          shown={reveal.shown}
          tone={reveal.done ? (res.ok ? 'pass' : 'fail') : 'pending'}
          head={reveal.done ? (res.ok ? 'Verified in this browser' : 'Proof rejected') : 'Checking in this browser…'}
          meta={`${passed}/${rows.length}`}
          details={{ identity: 'npub · address', key_separation: 'keys differ' }}
          onHover={setHover}
        />
      )}
      <div className="hero__caption">
        <span>{caption}</span>
        {result && (
          <span className="hero__caption-actions">
            {canPay && (
              <button type="button" className="c-btn c-btn--accent c-btn--sm" onClick={() => setPayOpen(true)}>
                <IconWallet size={14} /> Tip 1,000 sats
              </button>
            )}
            {binding && (
              <button type="button" className="c-btn c-btn--ghost c-btn--sm hero__tool" onClick={() => setFlipped((f) => !f)} aria-pressed={flipped}>
                <IconFlip /> {flipped ? 'Front' : 'Statement'}
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

type SignStage = Exclude<CachetStage, 'sealed'>;

const SIGN_HEAD: Record<SignStage, string> = {
  empty: 'Generating two keys…',
  keys: 'Two fresh keys, one statement',
  bch: 'BCH key signed the statement',
  nostr: 'Nostr key signed the event',
};

/** A binding made and verified in this tab with throwaway keys. Nothing is published. */
const LocalExample = () => {
  const [ex, setEx] = useState<Example>();
  const [sign, setSign] = useState<SignStage>('empty');
  const [tampered, setTampered] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [run, setRun] = useState<string>();
  const [hover, setHover] = useState<CachetZone>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const mint = useCallback(
    (next: Example) => {
      clearTimers();
      setEx(next);
      setTampered(false);
      setRun(undefined);
      if (prefersReducedMotion()) {
        setSign('nostr');
        setRun(`${next.event.id}:ok`);
        return;
      }
      setSign('keys');
      later(700, () => setSign('bch'));
      later(1350, () => setSign('nostr'));
      later(1950, () => setRun(`${next.event.id}:ok`));
    },
    [clearTimers, later],
  );

  useEffect(() => {
    let live = true;
    void makeExample().then((e) => live && mint(e));
    return () => {
      live = false;
      clearTimers();
    };
  }, [mint, clearTimers]);

  const remint = () => {
    setFlipped(false);
    void makeExample().then(mint);
  };

  const toggleTamper = () => {
    if (!ex) return;
    clearTimers();
    const next = !tampered;
    setTampered(next);
    setRun(undefined);
    later(prefersReducedMotion() ? 0 : 620, () => setRun(`${ex.event.id}:${next ? 'forged' : 'ok'}`));
  };

  // Each run verifies for real, in this tab; the ledger then replays the checks one by one.
  const live = useMemo(() => {
    if (!ex || !run) return undefined;
    const event = run.endsWith(':forged') ? ex.forged.event : ex.event;
    const t0 = performance.now();
    const result = verifyBinding(event);
    return { result, ms: performance.now() - t0 };
  }, [ex, run]);

  const rows = heroRows(live?.result.checks);
  const reveal = useReveal(rows.length, live ? run : undefined, 170);
  const sealed = !!live && reveal.done;
  const ok = !!live?.result.ok;
  const stage: CachetStage = sealed ? 'sealed' : sign;
  const current = !reveal.done && reveal.shown > 0 ? ZONE_OF[rows[reveal.shown - 1]!.id] : undefined;
  const passed = rows.slice(0, reveal.shown).filter((c) => c.status === 'pass').length;

  const b = ex?.result.binding;
  const fb = ex?.forged.result.binding;
  const shownBinding = tampered ? fb : b;

  const head = sealed
    ? ok
      ? 'Verified in this tab · nothing published'
      : 'Swapped address rejected'
    : live
      ? 'Checking in this tab…'
      : tampered
        ? 'Swapping in an address this key does not own…'
        : SIGN_HEAD[sign];

  const status = sealed ? (
    ok ? (
      <span className="c-pill c-pill--active">Verified</span>
    ) : (
      <span className="c-pill c-pill--invalid">Invalid</span>
    )
  ) : (
    <span className="hero__signs" data-n={sign === 'nostr' ? 2 : sign === 'bch' ? 1 : 0}>
      <span className="c-dot" style={{ background: 'var(--dot-bch)' }} />
      <span className="c-dot" style={{ background: 'var(--dot-nostr)' }} />
      {live ? 'Checking…' : `${sign === 'nostr' ? 2 : sign === 'bch' ? 1 : 0} of 2 signed`}
    </span>
  );

  return (
    <>
      <Cachet
        stage={stage}
        verdict={ok ? 'valid' : 'void'}
        pubkey={ex?.nostr.pubkey}
        name="Example identity"
        cashaddr={tampered ? ex?.forged.cashaddr : b?.cashaddr}
        sealedCashaddr={tampered ? b?.cashaddr : undefined}
        serial={shownBinding?.bindingId}
        bchKey={tampered ? ex?.forged.signerKey : b?.bchPublicKey}
        expiresAt={b?.expiresAt}
        focus={hover ?? current}
        overprint={sealed && !ok ? 'VOID' : undefined}
        status={status}
        flipped={flipped}
        back={
          ex && shownBinding ? (
            <CachetBack
              message={shownBinding.message}
              bchSig={shownBinding.bchSignature}
              eventId={tampered ? ex.forged.event.id : ex.event.id}
              nostrSig={tampered ? ex.forged.event.sig : ex.event.sig}
              tampered={tampered}
            />
          ) : undefined
        }
      />
      <Ledger
        checks={rows}
        shown={reveal.shown}
        tone={sealed ? (ok ? 'pass' : 'fail') : 'pending'}
        head={head}
        meta={live ? `${passed}/${rows.length}${sealed ? ` · ${fmtMs(live.ms)}` : ''}` : undefined}
        details={{
          identity: 'npub · address',
          key_separation: 'keys differ',
          ...(tampered && ex ? { bch_signature: `recovers ${shortCashaddr(ex.forged.signer)}` } : {}),
        }}
        onHover={setHover}
      />
      <div className="hero__caption hero__deck">
        <span className="hero__caption-actions">
          <button
            type="button"
            className={`c-btn c-btn--sm hero__tool${tampered ? ' c-btn--secondary' : ' c-btn--ghost'}`}
            onClick={toggleTamper}
            disabled={!ex || sign !== 'nostr'}
            title={tampered ? 'Put the real address back' : 'Claim an address this key does not own'}
          >
            {tampered ? (
              <>
                <IconUndo size={13} /> Restore
              </>
            ) : (
              <>
                <IconAlert size={13} /> Swap address
              </>
            )}
          </button>
          <button type="button" className="c-btn c-btn--ghost c-btn--sm hero__tool" onClick={() => setFlipped((f) => !f)} disabled={!ex} aria-pressed={flipped}>
            <IconFlip /> {flipped ? 'Front' : 'Statement'}
          </button>
          <button type="button" className="c-btn c-btn--ghost c-btn--sm hero__tool" onClick={remint} title="Generate fresh keys and sign again">
            <IconRefresh size={13} /> New keys
          </button>
        </span>
        <Link href="/lab" className="hero__link">
          12 attacks <IconArrowRight size={14} />
        </Link>
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
