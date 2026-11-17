import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  binToHex,
  bindMessage,
  bindingIdOf,
  createStatement,
  isAddressError,
  npubEncode,
  parseCashAddr,
  recoverSigner,
  toggleTokenForm,
  type BindProof,
  type BindStatement,
} from '@cachet/core';
import { lookupIdentity, normalizeRelayUrl, uniqueRelays, type LookupResult, type PublishResult } from '@cachet/discovery';
import {
  CheckList,
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconChevron,
  IconDownload,
  IconLock,
  IconWallet,
  IconX,
  IconZap,
  Note,
  RelayList,
  Segmented,
  Spinner,
  relayHost,
  shortCashaddr,
  shortNpub,
  type RelayRow,
} from '@cachet/react';
import { config } from '../config.ts';
import { Cachet, CachetBack, IconFlip, type CachetStage } from '../components/Cachet.tsx';
import { useSession } from '../lib/session.tsx';
import { browserCache, clearPendingSign, readPendingSign } from '../lib/storage.ts';
import { publishBinding } from '../lib/publish.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';
import { NostrConnect } from '../components/NostrConnect.tsx';
import { BchConnect } from '../components/BchConnect.tsx';
import { ManualSign } from '../components/ManualSign.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { downloadJson } from '../lib/download.ts';

const DAY = 86400;
const TTL_OPTIONS = [
  { value: 7 * DAY, label: '7 days' },
  { value: 30 * DAY, label: '30 days' },
  { value: 90 * DAY, label: '90 days' },
  { value: 365 * DAY, label: '1 year' },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type StepState = 'done' | 'current' | 'todo';

const Step = ({
  n,
  title,
  state,
  summary,
  onChange,
  locked,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: React.ReactNode;
  onChange?: () => void;
  locked?: boolean;
  children?: React.ReactNode;
}) => (
  <section className="step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
    <header className="step__head">
      <span className="step__num">{state === 'done' ? <IconCheck size={13} strokeWidth={2.2} /> : n}</span>
      <span className="step__title">{title}</span>
      {state === 'done' && (
        <span className="step__summary">
          {summary}
          {onChange && (
            <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={onChange} disabled={locked}>
              Change
            </button>
          )}
        </span>
      )}
    </header>
    {state === 'current' && <div className="step__body">{children}</div>}
  </section>
);

const RelayEditor = ({ relays, onChange, disabled }: { relays: string[]; onChange: (r: string[]) => void; disabled?: boolean }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = value.trim();
    const local = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(raw);
    const url = normalizeRelayUrl(/^wss?:\/\//i.test(raw) ? raw : `${local ? 'ws' : 'wss'}://${raw}`);
    const host = url ? new URL(url).hostname : '';
    const validHost = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/i.test(host) && (host.includes('.') || host.startsWith('[') || host === 'localhost');
    if (!url || !validHost) return setError('Enter a relay address like wss://relay.example');
    if (relays.some((r) => relayHost(r) === relayHost(url))) return setError(`${relayHost(url)} is already in the list.`);
    onChange(uniqueRelays(relays, [url]));
    setValue('');
  };
  return (
    <div className="relay-editor">
      <div className="relay-chips">
        {relays.map((r) => (
          <span key={r} className="relay-chip">
            {relayHost(r)}
            <button
              type="button"
              className="c-icon-btn"
              aria-label={`Remove ${relayHost(r)}`}
              title={relays.length <= 1 ? 'At least one relay is needed' : `Remove ${relayHost(r)}`}
              onClick={() => onChange(relays.filter((x) => x !== r))}
              disabled={disabled || relays.length <= 1}
            >
              <IconX size={12} />
            </button>
          </span>
        ))}
      </div>
      <form className="relay-add" onSubmit={add}>
        <input
          className="c-input"
          aria-label="Add relay URL"
          aria-invalid={!!error || undefined}
          placeholder="wss://relay.example"
          value={value}
          onChange={(e) => (setValue(e.target.value), setError(undefined))}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
        />
        <button className="c-btn c-btn--secondary c-btn--sm" type="submit" disabled={disabled || !value.trim()}>
          Add
        </button>
      </form>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
};

type Published = Awaited<ReturnType<typeof publishBinding>>;

export const Create = () => {
  const { nostr, bch, setBch, disconnectNostr, startSandbox } = useSession();
  const [, navigate] = useLocation();
  const [profile, setProfile] = useState<LookupResult>();
  const [chosen, setChosen] = useState<string>();
  const [tokenAware, setTokenAware] = useState(false);
  const [ttl, setTtl] = useState(30 * DAY);
  const [relays, setRelays] = useState(config.relays);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [statement, setStatement] = useState<BindStatement>();
  const [signature, setSignature] = useState<string>();
  const [busy, setBusy] = useState<'bch' | 'publish'>();
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<PublishResult[]>([]);
  const [published, setPublished] = useState<Published>();
  const [flipped, setFlipped] = useState(false);
  const [expressMode, setExpressMode] = useState(() => new URLSearchParams(window.location.search).get('sandbox') === '1');
  const expressRan = useRef(false);

  usePageTitle(published ? 'Link published' : 'New link');

  // If arrived via ?sandbox=1 without keys initialized yet, spin up sandbox keys immediately.
  useEffect(() => {
    if (expressMode && (!nostr || !bch)) {
      startSandbox();
    }
  }, [expressMode, nostr, bch, startSandbox]);

  // Read the current profile: name, NIP-65 write relays, existing claims to keep.
  useEffect(() => {
    setProfile(undefined);
    if (!nostr) return;
    let live = true;
    void lookupIdentity(nostr.pubkey, { relays: config.relays, indexers: config.indexers, cache: browserCache, timeout: 4000 }).then((r) => {
      if (!live) return;
      setProfile(r);
      if (r.relayList.write.length) setRelays((cur) => uniqueRelays(cur, r.relayList.write.slice(0, 3)));
    });
    return () => {
      live = false;
    };
  }, [nostr]);

  // Address choice follows the connected wallet.
  useEffect(() => {
    setChosen(bch?.addresses[0]);
    setTokenAware(false);
  }, [bch]);

  const parsedChosen = chosen ? parseCashAddr(chosen) : undefined;
  const effective = useMemo(() => {
    if (!parsedChosen || isAddressError(parsedChosen)) return undefined;
    if (tokenAware && !parsedChosen.tokenAware) return toggleTokenForm(parsedChosen) ?? undefined;
    return parsedChosen.address;
  }, [parsedChosen, tokenAware]);

  // A new statement whenever what it says changes; any earlier signature no longer applies.
  useEffect(() => {
    setSignature(undefined);
    setError(undefined);
    setResults([]);
    if (!nostr || !effective) return setStatement(undefined);
    setStatement(createStatement({ cashaddr: effective, nostrPubkey: nostr.pubkey, ttlSeconds: ttl }));
  }, [nostr, effective, ttl]);

  const message = statement ? bindMessage(statement) : undefined;
  const step: 1 | 2 | 3 = !nostr ? 1 : !bch || !effective ? 2 : 3;
  const bothLocal = nostr?.signer.type === 'local' && bch?.kind === 'local';
  const locked = !!busy;

  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  const signBch = async () => {
    if (!bch?.signer || !message || !effective) return;
    setBusy('bch');
    setError(undefined);
    try {
      setSignature(await bch.signer.signMessage(message, effective));
    } catch (e) {
      fail(e, 'The wallet did not sign.');
    } finally {
      setBusy(undefined);
    }
  };

  /** Publishes with `sig`, or first signs with the local BCH signer with a visible magnetic-pull beat. */
  const publish = useCallback(
    async (sig?: string) => {
      if (!nostr || !statement) return;
      setError(undefined);
      setResults([]);
      try {
        let bchSig = sig ?? signature;
        if (!bchSig) {
          if (!bch?.signer || !message || !effective) return;
          setBusy('bch');
          bchSig = await bch.signer.signMessage(message, effective);
          setSignature(bchSig);
          if (!prefersReducedMotion()) await wait(340);
        }
        setBusy('publish');
        const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: bchSig };
        const out = await publishBinding({ nostr, proof, relays, onResult: (r) => setResults((prev) => [...prev, r]) });
        if (!out.results.some((r) => r.ok)) throw new Error('No relay accepted the event. Try other relays.');
        setPublished(out);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        fail(e, 'Publishing failed.');
      } finally {
        setBusy(undefined);
        setExpressMode(false);
      }
    },
    [nostr, statement, signature, bch, message, effective, relays],
  );

  // Express 1-click sandbox run: StrictMode-safe timer strips ?sandbox=1 and runs dual-sign + publish once.
  useEffect(() => {
    if (!expressMode || expressRan.current || !nostr || !bch?.signer || !statement || !message || !effective || busy || published) return;
    const t = setTimeout(() => {
      expressRan.current = true;
      if (window.location.search.includes('sandbox=1')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      void publish();
    }, 60);
    return () => clearTimeout(t);
  }, [expressMode, nostr, bch, statement, message, effective, busy, published, publish]);

  const runInstantSandbox = () => {
    expressRan.current = false;
    startSandbox();
    setExpressMode(true);
  };

  const existingClaims = profile?.resolution.latest?.tags.filter((t) => t[0] === 'i').map((t) => t[1]!) ?? [];
  const replacing = !!effective && existingClaims.includes(`bch:${effective}`);
  const otherClaims = existingClaims.filter((c) => c !== `bch:${effective}`);
  const publishRows: RelayRow[] = relays.map((url) => {
    const r = results.find((x) => x.url === url);
    if (!r) return { url, tone: busy === 'publish' ? 'wait' : 'idle', note: busy === 'publish' ? 'Sending…' : '' };
    return { url, tone: r.ok ? 'good' : r.status === 'timeout' ? 'warn' : 'bad', note: r.ok ? 'Accepted' : r.message || r.status, ms: r.ms };
  });

  const npub = nostr ? npubEncode(nostr.pubkey) : undefined;
  const accepted = results.filter((r) => r.ok).length;
  const pendingSign = published ? readPendingSign() : null;
  const showRelayProgress = busy === 'publish' || results.length > 0;
  const ttlLabel = TTL_OPTIONS.find((o) => o.value === ttl)?.label ?? '30 days';
  const isCashTokens = Boolean(effective?.startsWith('bitcoincash:z'));

  const sealedBinding = published?.check.binding;
  const draftBchKey = useMemo(() => {
    if (!message || !signature) return undefined;
    const rec = recoverSigner(message, signature);
    return rec.ok && rec.compressed ? binToHex(rec.publicKey) : undefined;
  }, [message, signature]);
  const draftSerial = useMemo(() => (message ? bindingIdOf(message) : undefined), [message]);

  const cardStage: CachetStage = published
    ? 'sealed'
    : signature
      ? busy === 'publish'
        ? 'nostr'
        : 'bch'
      : nostr || effective
        ? 'keys'
        : 'empty';
  const signedCount = published || (signature && busy === 'publish') ? 2 : signature ? 1 : 0;
  const backMessage = sealedBinding?.message ?? message;
  const canInspectBack = Boolean(backMessage);

  useEffect(() => {
    if (!backMessage) setFlipped(false);
  }, [backMessage]);

  useEffect(() => {
    if (published) setFlipped(false);
  }, [published]);

  const cardStatus = published ? (
    published.check.ok ? (
      <span className="c-pill c-pill--active">Verified</span>
    ) : (
      <span className="c-pill c-pill--invalid">Invalid</span>
    )
  ) : (
    <span className="hero__signs" data-n={signedCount}>
      <span className="c-dot" style={{ background: 'var(--dot-bch)' }} />
      <span className="c-dot" style={{ background: 'var(--dot-nostr)' }} />
      {busy === 'publish'
        ? 'Sealing…'
        : signature
          ? '1 of 2 signed'
          : nostr && effective
            ? '0 of 2 signed'
            : 'Draft · connect keys'}
    </span>
  );

  return (
    <div className="wrap page">
      <div className="page-head page-head--split">
        <div>
          <h1>{published ? 'Your link is live' : 'New link'}</h1>
          <p>
            {published
              ? `Sealed and accepted by ${accepted} of ${relays.length} ${relays.length === 1 ? 'relay' : 'relays'}. Any wallet or app can verify it now.`
              : 'Connect a Nostr key and a BCH wallet, then sign once with each.'}
          </p>
        </div>
        {!published && !nostr && !bch && (
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={runInstantSandbox}>
            <IconZap size={14} /> Instant sandbox
          </button>
        )}
      </div>
      <div className="create">
        <div className="create__main">
          {published ? (
            <div className="c-card done-card">
              {pendingSign ? (
                <div className="done-pending">
                  <Note tone="ok">{pendingSign.app} is waiting for you to finish signing in.</Note>
                  <button
                    type="button"
                    className="c-btn c-btn--accent c-btn--lg"
                    onClick={() => {
                      clearPendingSign();
                      navigate(`/sign${pendingSign.search}`);
                    }}
                  >
                    Continue to {pendingSign.app} <IconArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="done-launch">
                  <div className="done-card__actions">
                    <Link className="c-btn c-btn--accent" href={`/p/${npub}`}>
                      <IconWallet size={15} /> Open payable profile <IconArrowRight size={14} />
                    </Link>
                    {npub && <ShareButton url={`${window.location.origin}/p/${npub}`} title="My Cachet identity" label="Share profile" />}
                    <button
                      type="button"
                      className="c-btn c-btn--ghost c-btn--sm done-card__proof"
                      onClick={() => downloadJson(`cachet-${shortNpub(nostr!.pubkey)}.json`, published.event)}
                    >
                      <IconDownload size={14} /> Proof JSON
                    </button>
                  </div>
                  <div className="done-apps">
                    {config.apps.map((app) => (
                      <a key={app.id} className="done-app" href={app.url} target="_blank" rel="noreferrer">
                        <span className="done-app__icon" data-app={app.id}>
                          <IconLock size={15} />
                        </span>
                        <span className="done-app__body">
                          <strong>Sign in to {app.name}</strong>
                          <small>{app.id === 'a' ? 'Unlock member notes' : 'Verified BCH checkout'}</small>
                        </span>
                        <IconArrowUpRight size={15} className="done-app__arrow" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="c-section-title">Relay receipts</h3>
                <RelayList rows={publishRows} />
              </div>
              <div>
                <h3 className="c-section-title">Verified locally before broadcast</h3>
                <CheckList checks={published.check.checks} />
              </div>
              {published.kept.length > 0 && (
                <p className="muted done-card__kept">Kept in the same snapshot: {published.kept.join(', ')}</p>
              )}
            </div>
          ) : (
            <>
              <Step
                n={1}
                title="Nostr key"
                state={step === 1 ? 'current' : 'done'}
                summary={nostr && <span className="mono">{shortNpub(nostr.pubkey)}</span>}
                onChange={disconnectNostr}
                locked={locked}
              >
                <NostrConnect />
              </Step>

              <Step
                n={2}
                title="BCH address"
                state={step < 2 ? 'todo' : step === 2 ? 'current' : 'done'}
                summary={effective && <span className="mono">{shortCashaddr(effective)}</span>}
                onChange={() => setBch(undefined)}
                locked={locked}
              >
                {!bch ? (
                  <BchConnect />
                ) : bch.kind === 'walletconnect' ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div className="addr-choice">{bch.addresses[0]}</div>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Active address in {bch.label}. Switch accounts in your wallet to use another.
                    </span>
                  </div>
                ) : (
                  <div className="addr-list" role="radiogroup" aria-label="Address to link">
                    {bch.addresses.map((a) => (
                      <label key={a} className="addr-choice">
                        <input type="radio" name="addr" checked={chosen === a} onChange={() => setChosen(a)} />
                        {a}
                      </label>
                    ))}
                  </div>
                )}
              </Step>

              <Step n={3} title="Sign and publish" state={step < 3 ? 'todo' : 'current'}>
                <div className="create-params" data-open={customizeOpen || undefined}>
                  <div className="create-params__bar">
                    <span className="create-params__summary">
                      Valid <strong>{ttlLabel}</strong> · <strong>{relays.length}</strong> {relays.length === 1 ? 'relay' : 'relays'}
                      {isCashTokens ? ' · CashTokens' : ''}
                    </span>
                    <button
                      type="button"
                      className="c-btn c-btn--ghost c-btn--sm create-params__toggle"
                      aria-expanded={customizeOpen}
                      onClick={() => setCustomizeOpen(!customizeOpen)}
                      disabled={locked}
                    >
                      {customizeOpen ? 'Done' : 'Customize'} <IconChevron size={14} />
                    </button>
                  </div>
                  {customizeOpen && (
                    <div className="create-params__body">
                      {parsedChosen && !isAddressError(parsedChosen) && !parsedChosen.tokenAware && (
                        <label className="check-row" data-disabled={locked || undefined}>
                          <input type="checkbox" checked={tokenAware} onChange={(e) => setTokenAware(e.target.checked)} disabled={locked} />
                          <span>
                            My wallet accepts CashTokens at this address
                            <span className="muted check-row__hint">Publishes the z… form of the same key. Leave off if unsure.</span>
                          </span>
                        </label>
                      )}
                      <div className="field-row">
                        <span className="c-label">Valid for</span>
                        <Segmented value={ttl} options={TTL_OPTIONS} onChange={setTtl} label="Validity" disabled={locked} />
                      </div>
                      <div>
                        <span className="c-label">Relays</span>
                        <RelayEditor relays={relays} onChange={setRelays} disabled={locked} />
                      </div>
                    </div>
                  )}
                </div>

                {existingClaims.length > 0 && (
                  <Note>
                    {replacing ? 'Replaces your current link for this address. ' : ''}
                    {otherClaims.length ? `Your other claims stay: ${otherClaims.join(', ')}.` : 'No other claims in your profile.'}
                  </Note>
                )}

                <div className="sig-track" aria-label="Dual-signature progress">
                  <span className="sig-track__pill" data-state={signature ? 'done' : busy === 'bch' ? 'now' : 'ready'}>
                    <span className="sig-track__dot">
                      {signature ? <IconCheck size={11} strokeWidth={2.4} /> : busy === 'bch' ? <Spinner /> : '1'}
                    </span>
                    BCH statement
                  </span>
                  <span className="sig-track__line" data-done={Boolean(signature) || undefined} aria-hidden />
                  <span className="sig-track__pill" data-state={busy === 'publish' ? 'now' : signature ? 'ready' : 'todo'}>
                    <span className="sig-track__dot">{busy === 'publish' ? <Spinner /> : '2'}</span>
                    Nostr event
                  </span>
                </div>

                {bch?.kind === 'manual' && message && effective && !signature ? (
                  <ManualSign message={message} address={effective} onSigned={setSignature} />
                ) : !signature && bothLocal ? (
                  <>
                    {showRelayProgress && <RelayList rows={publishRows} />}
                    <button type="button" className="c-btn c-btn--lg" onClick={() => void publish()} disabled={locked || !message}>
                      {locked && <Spinner />}
                      {busy === 'bch'
                        ? 'Signing BCH statement…'
                        : busy === 'publish'
                          ? 'Sealing & publishing to relays…'
                          : 'Sign with sandbox keys and publish'}
                    </button>
                  </>
                ) : !signature ? (
                  <button type="button" className="c-btn c-btn--lg" onClick={signBch} disabled={locked || !message}>
                    {busy === 'bch' && <Spinner />}
                    {busy === 'bch' ? `Confirm in ${bch?.label ?? 'your wallet'}…` : `Sign with ${bch?.label ?? 'BCH wallet'}`}
                  </button>
                ) : (
                  <>
                    <div className="signed-line">
                      <IconCheck /> BCH signature checks out for {shortCashaddr(effective!)}
                    </div>
                    {showRelayProgress && <RelayList rows={publishRows} />}
                    <button type="button" className="c-btn c-btn--accent c-btn--lg" onClick={() => void publish()} disabled={locked}>
                      {busy === 'publish' && <Spinner />}
                      {busy === 'publish' ? 'Publishing…' : `Sign with ${nostr?.signer.label ?? 'Nostr'} and publish`}
                    </button>
                  </>
                )}
                {error && <Note tone="danger">{error}</Note>}
              </Step>
            </>
          )}
        </div>

        <aside className="create__aside">
          <Cachet
            stage={cardStage}
            verdict={published && !published.check.ok ? 'void' : 'valid'}
            pubkey={sealedBinding?.nostrPubkey ?? nostr?.pubkey}
            emptyNostr="Connect a Nostr key"
            name={profile?.profile?.displayName || profile?.profile?.name}
            picture={profile?.profile?.picture}
            cashaddr={sealedBinding?.cashaddr ?? effective}
            emptyBch="Connect a BCH wallet"
            tokenAware={sealedBinding?.tokenAware ?? isCashTokens}
            serial={sealedBinding?.bindingId ?? draftSerial}
            bchKey={sealedBinding?.bchPublicKey ?? draftBchKey}
            expiresAt={sealedBinding?.expiresAt ?? statement?.expires_at}
            overprint={published && !published.check.ok ? 'VOID' : undefined}
            status={cardStatus}
            flipped={flipped}
            onFlip={canInspectBack ? () => setFlipped((f) => !f) : undefined}
            back={
              <CachetBack
                message={backMessage}
                bchSig={sealedBinding?.bchSignature ?? signature}
                eventId={published?.event.id}
                nostrSig={published?.event.sig}
                emptyNote="Connect both keys to generate the statement."
              />
            }
          />
          {canInspectBack && (
            <div className="create__deck">
              <button
                type="button"
                className="c-btn c-btn--ghost c-btn--sm hero__tool"
                onClick={() => setFlipped((f) => !f)}
                aria-pressed={flipped}
              >
                <IconFlip /> {flipped ? 'Front of card' : published ? 'Signed statement' : 'What your wallet signs'}
              </button>
              <span className="muted create__deck-hint">{flipped ? 'Back · SHA-256D payload' : 'Click or drag card to flip'}</span>
            </div>
          )}
          {!published && profile === undefined && nostr && (
            <div className="row muted aside-status">
              <Spinner /> Reading your current Nostr profile…
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
