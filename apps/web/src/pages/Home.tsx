import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CHECK_LABELS, npubEncode, verifyBinding, type BindingState, type Check, type CheckId } from '@cachet/core';
import {
  Dialog,
  IconAlert,
  IconArrowRight,
  IconArrowUpRight,
  IconBeaker,
  IconCheck,
  IconRefresh,
  IconUndo,
  IconWallet,
  IconZap,
  Spinner,
  StatePill,
  plural,
  shortCashaddr,
  shortNpub,
} from '@cachet/react';
import { config } from '../config.ts';
import { SearchBox } from '../components/SearchBox.tsx';
import { Cachet, CachetBack, IconFlip, Ledger, STAMP_OF, ZONE_OF, useReveal, type CachetStage, type CachetZone } from '../components/Cachet.tsx';
import { useLookup, type LookupState } from '../lib/useLookup.ts';
import { makeExample, type Example } from '../lib/example.ts';
import { prefersReducedMotion } from '../lib/motion.ts';
import { useSession } from '../lib/session.tsx';

const PayPanel = lazy(() => import('../components/PayPanel.tsx').then((m) => ({ default: m.PayPanel })));

const CAPTIONS: Record<Exclude<BindingState, 'active'>, string> = {
  withdrawn: 'The owner withdrew this link.',
  expired: 'This link has expired.',
  invalid: 'The published proof does not verify.',
  not_found: 'No link on the relays checked.',
  unavailable: 'Relays did not answer.',
};

const HERO_CHECKS: CheckId[] = ['event', 'identity', 'time', 'bch_signature', 'key_separation'];
const PENDING: Check[] = HERO_CHECKS.map((id) => ({ id, label: CHECK_LABELS[id], status: 'skip' }));
const heroRows = (checks?: Check[]) => (checks ? checks.filter((c) => HERO_CHECKS.includes(c.id)) : PENDING);

const fmtMs = (ms: number) => (ms < 0.1 ? '<0.1 ms' : ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`);

const Featured = ({ state, own }: { state: LookupState; own: boolean }) => {
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
      ? `Asking ${asked || config.relays.length} ${plural(asked || config.relays.length, 'relay')}…`
      : state.status === 'error'
        ? state.message
        : resolution!.state === 'active'
          ? `On ${seen} of ${asked} ${plural(asked, 'relay')} · verified in this browser`
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
        overprint={bindingState ? STAMP_OF[bindingState] : undefined}
        status={settled && bindingState ? <StatePill state={bindingState} /> : <StatePill state="loading" />}
        flipped={flipped && !!binding}
        onFlip={binding ? () => setFlipped((f) => !f) : undefined}
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
        onFlip={ex ? () => setFlipped((f) => !f) : undefined}
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
          Try to break it <IconArrowRight size={14} />
        </Link>
      </div>
    </>
  );
};

type LinkState = BindingState | 'none' | 'checking';

const linkStateOf = (hasKey: boolean, state: LookupState): LinkState => {
  if (!hasKey) return 'none';
  if (state.status === 'done') return state.result.resolution.state;
  return state.status === 'error' ? 'unavailable' : 'checking';
};

/**
 * The demo path: make a link, use it, then withdraw it.
 * Steps tick off from the visitor's own link on the relays, so the next thing to do is always clear.
 */
const Loop = ({ link, npub, cashaddr, onSandbox }: { link: LinkState; npub?: string; cashaddr?: string; onSandbox: () => void }) => {
  // An expired link has to be made again before the apps will take it, so it does not count as made.
  const made = link === 'active' || link === 'withdrawn';
  const withdrawn = link === 'withdrawn';
  const hasApps = config.apps.length > 0;
  const withdrawHint = hasApps
    ? 'Switch back to the app. Its next check ends your session.'
    : 'Refresh the proof tab to see what others can verify.';
  // Step 2 happens in a separate tab, so it can't be observed here: it counts as done once
  // the link is withdrawn, and stays open alongside step 3 while the link is active.
  const states: Record<1 | 2 | 3, 'done' | 'current' | 'todo'> = {
    1: made ? 'done' : 'current',
    2: withdrawn ? 'done' : made ? 'current' : 'todo',
    3: withdrawn ? 'done' : link === 'active' ? 'current' : 'todo',
  };
  const step = (n: 1 | 2 | 3) => states[n];
  const mark = (n: 1 | 2 | 3) =>
    step(n) === 'done' ? (
      <span className="loop__n" data-done>
        <IconCheck size={12} strokeWidth={2.4} />
        <span className="sr-only">Done</span>
      </span>
    ) : (
      <span className="loop__n">{`0${n}`}</span>
    );

  return (
    <section className="loop" aria-labelledby="loop-title">
      <div className="loop__head">
        <h2 id="loop-title">Try the whole loop</h2>
        <p>
          {hasApps
            ? 'Make a link, use it to sign in, then withdraw it and see the app stop accepting it.'
            : 'Make a link, verify it on your public profile, then withdraw it and check what others see.'}
        </p>
      </div>
      <ol className="loop__steps">
        <li data-state={step(1)}>
          {mark(1)}
          <h3>Make a link</h3>
          {made && cashaddr ? (
            <p>
              Published for <span className="mono">{shortCashaddr(cashaddr)}</span>. Anyone can verify it from the relays.
            </p>
          ) : link === 'expired' && cashaddr ? (
            <p>
              Your link for <span className="mono">{shortCashaddr(cashaddr)}</span> expired. Publish a fresh one to continue.
            </p>
          ) : (
            <p>Sandbox keys sign and publish in one click. Use your own wallets when you want a link that lasts.</p>
          )}
          <div className="loop__act">
            {made && npub ? (
              <Link href={`/p/${npub}`} className="loop__go">
                Your profile <IconArrowRight size={14} />
              </Link>
            ) : (
              <>
                <button type="button" className="c-btn c-btn--sm" onClick={onSandbox} disabled={link === 'checking'}>
                  <IconZap size={13} /> Sandbox link
                </button>
                <Link href="/new" className="loop__go">
                  With a wallet <IconArrowRight size={14} />
                </Link>
              </>
            )}
          </div>
        </li>
        <li data-state={step(2)}>
          {mark(2)}
          <h3>{hasApps ? 'Sign in with your link' : 'Verify your public proof'}</h3>
          <p>
            {hasApps
              ? 'Each example app checks your link on the relays itself.'
              : 'Your public profile reads the proof from the relays and checks both signatures.'}
          </p>
          <div className="loop__act">
            {config.apps.map((a) => (
              <a key={a.id} className="loop__go" href={a.url} target="_blank" rel="noreferrer">
                {a.name} <IconArrowUpRight size={13} />
              </a>
            ))}
            {!hasApps && made && npub && (
              <a className="loop__go" href={`/p/${npub}`} target="_blank" rel="noreferrer">
                Open proof in a new tab <IconArrowUpRight size={13} />
              </a>
            )}
          </div>
        </li>
        <li data-state={step(3)}>
          {mark(3)}
          <h3>Withdraw it</h3>
          <p>{withdrawn ? 'Link withdrawn.' : 'Withdraw the link from your profile.'} {withdrawHint}</p>
          <div className="loop__act">
            {withdrawn ? (
              <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={onSandbox}>
                <IconRefresh size={13} /> Start over
              </button>
            ) : link === 'active' && npub ? (
              <Link href={`/p/${npub}`} className="loop__go">
                Withdraw on your profile <IconArrowRight size={14} />
              </Link>
            ) : (
              <span className="loop__wait">After step 1</span>
            )}
          </div>
        </li>
      </ol>
      <Link href="/lab" className="loop__lab">
        <span className="loop__lab-icon" aria-hidden>
          <IconBeaker size={16} />
        </span>
        <span className="loop__lab-text">
          <strong>Lab</strong>
          <span>Swap the address, replay the proof under another npub, mirror a key. Eleven attacks, each stopped by a named check.</span>
        </span>
        <IconArrowRight size={15} className="loop__lab-go" />
      </Link>
    </section>
  );
};

export const Home = () => {
  const { nostr, startSandbox } = useSession();
  const [, navigate] = useLocation();
  const myNpub = nostr ? npubEncode(nostr.pubkey) : undefined;
  const payableTarget = config.featured ?? myNpub;
  const own = !config.featured && !!myNpub;
  // One relay query per identity: when the hero card shows your own key, the loop reuses its answer.
  const target = useLookup(payableTarget);
  const mine = useLookup(own ? undefined : myNpub);
  const myState = own ? target.state : mine.state;
  const myClaim = myState.status === 'done' ? myState.result.resolution.primary : undefined;

  const startQuickTest = () => {
    startSandbox();
    navigate('/new?sandbox=1');
  };

  return (
    <div className="wrap page">
      <section className="hero">
        <div className="hero__copy">
          <h1>Link your Bitcoin Cash address to your Nostr key.</h1>
          <p className="lede">
            Both keys sign one statement. It lives on Nostr relays, so any wallet or app can check who an address belongs to without asking us.
          </p>
          <div className="hero__actions">
            <Link href="/new" className="c-btn c-btn--lg">
              Create your link
            </Link>
            <button type="button" className="c-btn c-btn--lg c-btn--secondary hero__sandbox-btn" onClick={startQuickTest}>
              <IconZap size={16} /> Sandbox demo
            </button>
          </div>
          <SearchBox />
        </div>
        <div className="hero__card">{payableTarget ? <Featured key={payableTarget} state={target.state} own={own} /> : <LocalExample />}</div>
      </section>

      <Loop link={linkStateOf(!!myNpub, myState)} npub={myNpub} cashaddr={myClaim?.cashaddr} onSandbox={startQuickTest} />
    </div>
  );
};
