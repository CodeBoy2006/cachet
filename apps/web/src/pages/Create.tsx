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
  type NostrEvent,
} from '@cachet/core';
import { lookupIdentity, uniqueRelays, type LookupResult, type PublishResult } from '@cachet/discovery';
import {
  CheckList,
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
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: React.ReactNode;
  onChange?: () => void;
  children?: React.ReactNode;
}) => (
  <section className="step" data-state={state}>
    <header className="step__head">
      <span className="step__num">{state === 'done' ? <IconCheck size={13} strokeWidth={2.2} /> : n}</span>
      <span className="step__title">{title}</span>
      {state === 'done' && (
        <span className="step__summary">
          {summary}
          {onChange && (
            <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={onChange}>
              Change
            </button>
          )}
        </span>
      )}
    </header>
    {state === 'current' && <div className="step__body">{children}</div>}
  </section>
);

const RelayEditor = ({ relays, onChange }: { relays: string[]; onChange: (r: string[]) => void }) => {
  const [value, setValue] = useState('');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const next = uniqueRelays(relays, [value.startsWith('ws') ? value : `wss://${value}`]);
    if (next.length > relays.length) onChange(next);
    setValue('');
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="relay-chips">
        {relays.map((r) => (
          <span key={r} className="relay-chip">
            {relayHost(r)}
            <button type="button" className="c-icon-btn" aria-label={`Remove ${r}`} onClick={() => onChange(relays.filter((x) => x !== r))} disabled={relays.length <= 1}>
              <IconX size={12} />
            </button>
          </span>
        ))}
      </div>
      <form className="relay-add" onSubmit={add}>
        <input
          className="c-input"
          aria-label="Add relay URL"
          placeholder="wss://relay.example"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
        <button className="c-btn c-btn--secondary c-btn--sm" type="submit" disabled={!value.trim()}>
          Add
        </button>
      </form>
    </div>
  );
};

export const Create = () => {
  const { nostr, bch, setBch, disconnectNostr, useQuickSandbox } = useSession();
  const [, navigate] = useLocation();
  const [editNostr, setEditNostr] = useState(false);
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
  const [published, setPublished] = useState<{ event: NostrEvent; check: Awaited<ReturnType<typeof publishBinding>>['check']; kept: string[] }>();

  const nostrDone = !!nostr && !editNostr;

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
    if (!nostr || !effective) return setStatement(undefined);
    setStatement(createStatement({ cashaddr: effective, nostrPubkey: nostr.pubkey, ttlSeconds: ttl }));
  }, [nostr, effective, ttl]);

  const message = statement ? bindMessage(statement) : undefined;
  const step: 1 | 2 | 3 = !nostrDone ? 1 : !bch || !effective ? 2 : 3;
  const bothLocal = nostr?.signer.type === 'local' && bch?.kind === 'local';

  const signBch = async () => {
    if (!bch?.signer || !message || !effective) return;
    setBusy('bch');
    setError(undefined);
    try {
      setSignature(await bch.signer.signMessage(message, effective));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The wallet did not sign.');
    } finally {
      setBusy(undefined);
    }
  };

  const publish = async () => {
    if (!nostr || !statement || !signature) return;
    const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: signature };
    setBusy('publish');
    setError(undefined);
    setResults([]);
    try {
      const out = await publishBinding({ nostr, proof, relays, onResult: (r) => setResults((prev) => [...prev, r]) });
      if (!out.results.some((r) => r.ok)) throw new Error('No relay accepted the event. Try other relays.');
      setPublished(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publishing failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const signAndPublish = async () => {
    if (!nostr || !bch?.signer || !statement || !message || !effective) return;
    setBusy('publish');
    setError(undefined);
    setResults([]);
    try {
      const sig = await bch.signer.signMessage(message, effective);
      setSignature(sig);
      const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: sig };
      const out = await publishBinding({ nostr, proof, relays, onResult: (r) => setResults((prev) => [...prev, r]) });
      if (!out.results.some((r) => r.ok)) throw new Error('No relay accepted the event. Try other relays.');
      setPublished(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publishing failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const existingClaims = profile?.resolution.latest?.tags.filter((t) => t[0] === 'i').map((t) => t[1]!) ?? [];
  const replacing = effective && existingClaims.includes(`bch:${effective}`);
  const publishRows: RelayRow[] = relays.map((url) => {
    const r = results.find((x) => x.url === url);
    if (!r) return { url, tone: busy === 'publish' ? 'wait' : 'idle', note: busy === 'publish' ? 'Sending…' : '' };
    return { url, tone: r.ok ? 'good' : r.status === 'timeout' ? 'warn' : 'bad', note: r.ok ? 'Accepted' : r.message || r.status, ms: r.ms };
  });

  const npub = nostr ? npubEncode(nostr.pubkey) : undefined;
  const accepted = results.filter((r) => r.ok).length;
  const pendingSign = published ? readPendingSign() : null;

  return (
    <div className="wrap">
      <div className="page-head row row--between">
        <div>
          <h1>{published ? 'Your link is live' : 'New link'}</h1>
          <p>{published ? `Published to ${accepted} of ${relays.length} relays. Anyone can verify it now.` : 'Connect a Nostr key and a BCH wallet, then sign once with each.'}</p>
        </div>
        {!published && !nostrDone && !bch && (
          <button
            type="button"
            className="c-btn c-btn--secondary c-btn--sm"
            onClick={() => {
              useQuickSandbox();
              setEditNostr(false);
            }}
          >
            <IconKey size={14} /> Use sandbox keys
          </button>
        )}
      </div>
      <div className="create">
        <div>
          {published ? (
            <div className="c-card done-card">
              <RelayList rows={publishRows} />
              <CheckList checks={published.check.checks} />
              {published.kept.length > 0 && (
                <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                  Kept in the same snapshot: {published.kept.join(', ')}
                </p>
              )}
              <div className="row">
                {pendingSign && (
                  <button
                    type="button"
                    className="c-btn c-btn--accent"
                    onClick={() => {
                      clearPendingSign();
                      navigate(`/sign${pendingSign.search}`);
                    }}
                  >
                    Continue sign-in to {pendingSign.app} <IconArrowRight size={14} />
                  </button>
                )}
                <Link className={pendingSign ? 'c-btn c-btn--secondary' : 'c-btn'} href={`/p/${npub}`}>
                  View &amp; pay profile
                </Link>
                {config.apps.map((app) => (
                  <a key={app.id} className="c-btn c-btn--secondary" href={app.url} target="_blank" rel="noreferrer">
                    Sign in to {app.name} <IconArrowUpRight size={14} />
                  </a>
                ))}
                <button type="button" className="c-btn c-btn--ghost" onClick={() => downloadJson(`cachet-${shortNpub(nostr!.pubkey)}.json`, published.event)}>
                  <IconDownload /> Proof
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
                onChange={() => {
                  disconnectNostr();
                  setEditNostr(false);
                }}
              >
                <NostrConnect onDone={() => setEditNostr(false)} />
              </Step>

              <Step
                n={2}
                title="BCH address"
                state={step < 2 ? 'todo' : step === 2 ? 'current' : 'done'}
                summary={effective && <span className="mono">{shortCashaddr(effective)}</span>}
                onChange={() => setBch(undefined)}
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
                  <div className="addr-list">
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
                  <label className="check-row">
                    <input type="checkbox" checked={tokenAware} onChange={(e) => setTokenAware(e.target.checked)} />
                    <span>
                      My wallet accepts CashTokens at this address
                      <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                        Publishes the z… form of the same key. Leave off if unsure.
                      </span>
                    </span>
                  </label>
                )}
                <div className="row row--between">
                  <span className="c-label" style={{ margin: 0 }}>
                    Valid for
                  </span>
                  <Segmented value={ttl} options={TTL_OPTIONS} onChange={setTtl} label="Validity" />
                </div>
                <div>
                  <span className="c-label">Relays</span>
                  <RelayEditor relays={relays} onChange={setRelays} />
                </div>
                {existingClaims.length > 0 && (
                  <Note>
                    {replacing ? 'Replaces your current link for this address. ' : ''}
                    Your other claims stay: {existingClaims.filter((c) => c !== `bch:${effective}`).join(', ') || 'none'}.
                  </Note>
                )}

                {bch?.kind === 'manual' && message && effective && !signature ? (
                  <ManualSign message={message} address={effective} onSigned={setSignature} />
                ) : !signature && bothLocal ? (
                  <>
                    {(busy === 'publish' || results.length > 0) && <RelayList rows={publishRows} />}
                    <button type="button" className="c-btn c-btn--lg" onClick={signAndPublish} disabled={!!busy || !message}>
                      {busy === 'publish' ? <Spinner /> : null}
                      {busy === 'publish' ? 'Signing & publishing…' : 'Sign with sandbox keys & publish'}
                    </button>
                  </>
                ) : !signature ? (
                  <button type="button" className="c-btn c-btn--lg" onClick={signBch} disabled={busy === 'bch' || !message}>
                    {busy === 'bch' ? <Spinner /> : null}
                    {busy === 'bch' ? `Confirm in ${bch?.label ?? 'wallet'}…` : `Sign with ${bch?.label ?? 'BCH wallet'}`}
                  </button>
                ) : (
                  <div className="signed-line">
                    <IconCheck /> BCH signature checks out for {shortCashaddr(effective!)}
                  </div>
                )}

                {signature && (
                  <>
                    {(busy === 'publish' || results.length > 0) && <RelayList rows={publishRows} />}
                    <button type="button" className="c-btn c-btn--lg" onClick={publish} disabled={busy === 'publish'}>
                      {busy === 'publish' ? <Spinner /> : null}
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
              <pre className="c-code">{message}</pre>
            </details>
          )}
          {!published && profile === undefined && nostr && (
            <div className="row muted" style={{ fontSize: 13 }}>
              <Spinner /> Reading your current Nostr profile…
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
