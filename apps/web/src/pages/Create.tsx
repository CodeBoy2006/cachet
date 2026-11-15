import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  bindMessage,
  createStatement,
  isAddressError,
  npubEncode,
  parseCashAddr,
  toggleTokenForm,
  type BindProof,
  type BindStatement,
} from '@cachet/core';
import { lookupIdentity, normalizeRelayUrl, uniqueRelays, type LookupResult, type PublishResult } from '@cachet/discovery';
import {
  CheckList,
  CopyIcon,
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconChevron,
  IconDownload,
  IconKey,
  IconX,
  IdentityCard,
  Note,
  RelayList,
  Segmented,
  Spinner,
  formatDate,
  relayHost,
  shortCashaddr,
  shortNpub,
  type RelayRow,
} from '@cachet/react';
import { config } from '../config.ts';
import { useSession } from '../lib/session.tsx';
import { browserCache, clearPendingSign, readPendingSign } from '../lib/storage.ts';
import { publishBinding } from '../lib/publish.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';
import { NostrConnect } from '../components/NostrConnect.tsx';
import { BchConnect } from '../components/BchConnect.tsx';
import { ManualSign } from '../components/ManualSign.tsx';
import { downloadJson } from '../lib/download.ts';

const DAY = 86400;
const TTL_OPTIONS = [
  { value: 7 * DAY, label: '7 days' },
  { value: 30 * DAY, label: '30 days' },
  { value: 90 * DAY, label: '90 days' },
  { value: 365 * DAY, label: '1 year' },
];

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
    // Without a scheme, local dev relays get ws:// (they rarely have TLS); everything else wss://.
    const local = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(raw);
    const url = normalizeRelayUrl(/^wss?:\/\//i.test(raw) ? raw : `${local ? 'ws' : 'wss'}://${raw}`);
    const host = url ? new URL(url).hostname : '';
    // URL() percent-encodes junk into a "hostname"; accept only real DNS names, IPs and localhost.
    const validHost = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/i.test(host) && (host.includes('.') || host.startsWith('[') || host === 'localhost');
    if (!url || !validHost) return setError('Enter a relay address like wss://relay.example');
    // Chips show the host only, so ws:// and wss:// of one host would look like a duplicate.
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
  const [statement, setStatement] = useState<BindStatement>();
  const [signature, setSignature] = useState<string>();
  const [busy, setBusy] = useState<'bch' | 'publish'>();
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<PublishResult[]>([]);
  const [published, setPublished] = useState<Published>();

  usePageTitle(published ? 'Link published' : 'New link');

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

  /** Publishes with `sig`, or first asks the (local) BCH signer for one. */
  const publish = async (sig = signature) => {
    if (!nostr || !statement) return;
    setBusy('publish');
    setError(undefined);
    setResults([]);
    try {
      let bchSig = sig;
      if (!bchSig) {
        if (!bch?.signer || !message || !effective) return;
        bchSig = await bch.signer.signMessage(message, effective);
        setSignature(bchSig);
      }
      const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: bchSig };
      const out = await publishBinding({ nostr, proof, relays, onResult: (r) => setResults((prev) => [...prev, r]) });
      if (!out.results.some((r) => r.ok)) throw new Error('No relay accepted the event. Try other relays.');
      setPublished(out);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      fail(e, 'Publishing failed.');
    } finally {
      setBusy(undefined);
    }
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

  return (
    <div className="wrap page">
      <div className="page-head page-head--split">
        <div>
          <h1>{published ? 'Your link is live' : 'New link'}</h1>
          <p>
            {published
              ? `Accepted by ${accepted} of ${relays.length} ${relays.length === 1 ? 'relay' : 'relays'}. Anyone can verify it now.`
              : 'Connect a Nostr key and a BCH wallet, then sign once with each.'}
          </p>
        </div>
        {!published && !nostr && !bch && (
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={startSandbox}>
            <IconKey size={14} /> Use sandbox keys
          </button>
        )}
      </div>
      <div className="create">
        <div className="create__main">
          {published ? (
            <div className="c-card done-card">
              {pendingSign && (
                <Note tone="ok">
                  {pendingSign.app} is waiting for you to finish signing in.
                </Note>
              )}
              <div>
                <h3 className="c-section-title">Relays</h3>
                <RelayList rows={publishRows} />
              </div>
              <div>
                <h3 className="c-section-title">Checked before publishing</h3>
                <CheckList checks={published.check.checks} />
              </div>
              {published.kept.length > 0 && (
                <p className="muted done-card__kept">Kept in the same snapshot: {published.kept.join(', ')}</p>
              )}
              <div className="done-card__actions">
                {pendingSign ? (
                  <button
                    type="button"
                    className="c-btn c-btn--accent"
                    onClick={() => {
                      clearPendingSign();
                      navigate(`/sign${pendingSign.search}`);
                    }}
                  >
                    Continue to {pendingSign.app} <IconArrowRight size={14} />
                  </button>
                ) : (
                  <Link className="c-btn" href={`/p/${npub}`}>
                    View your profile <IconArrowRight size={14} />
                  </Link>
                )}
                {config.apps.map((app) => (
                  <a key={app.id} className="c-btn c-btn--secondary" href={app.url} target="_blank" rel="noreferrer">
                    Sign in to {app.name} <IconArrowUpRight size={14} />
                  </a>
                ))}
                <button
                  type="button"
                  className="c-btn c-btn--ghost done-card__proof"
                  onClick={() => downloadJson(`cachet-${shortNpub(nostr!.pubkey)}.json`, published.event)}
                >
                  <IconDownload size={15} /> Proof
                </button>
              </div>
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
                {existingClaims.length > 0 && (
                  <Note>
                    {replacing ? 'Replaces your current link for this address. ' : ''}
                    {otherClaims.length ? `Your other claims stay: ${otherClaims.join(', ')}.` : 'No other claims in your profile.'}
                  </Note>
                )}

                {bch?.kind === 'manual' && message && effective && !signature ? (
                  <ManualSign message={message} address={effective} onSigned={setSignature} />
                ) : !signature && bothLocal ? (
                  <>
                    {showRelayProgress && <RelayList rows={publishRows} />}
                    <button type="button" className="c-btn c-btn--lg" onClick={() => publish()} disabled={locked || !message}>
                      {busy === 'publish' && <Spinner />}
                      {busy === 'publish' ? 'Signing and publishing…' : 'Sign with sandbox keys and publish'}
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
                    <button type="button" className="c-btn c-btn--lg" onClick={() => publish()} disabled={locked}>
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
          <IdentityCard
            state={published ? (published.check.ok ? 'active' : 'invalid') : 'draft'}
            pubkey={nostr?.pubkey}
            name={profile?.profile?.displayName || profile?.profile?.name}
            picture={profile?.profile?.picture}
            cashaddr={effective}
            tokenAware={effective?.startsWith('bitcoincash:z')}
            expiresAt={statement?.expires_at}
            emptyNostr="Connect a key"
            emptyBch="Connect a wallet"
            foot={
              published ? undefined : (
                <span>
                  {signature ? 'Signed by BCH · ' : ''}
                  {statement ? `Valid until ${formatDate(statement.expires_at)}` : 'Draft'}
                </span>
              )
            }
          />
          {message && (
            <details className="statement-peek">
              <summary>
                What your wallet signs <IconChevron size={14} />
              </summary>
              <div className="message-box">
                <pre className="c-code">{message}</pre>
                <CopyIcon value={message} title="Copy message" />
              </div>
            </details>
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
