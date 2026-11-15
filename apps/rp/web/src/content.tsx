import { useEffect, useState } from 'react';
import { DEFAULT_ELECTRUM, ElectrumClient, formatBch, paymentUri, watchAddress, type IncomingPayment } from '@cachet/pay';
import { CopyChip, IconArrowUpRight, IconLock, IconRefresh, Qr, Spinner, shortCashaddr, shortMiddle, shortNpub } from '@cachet/react';
import { getNotes, getStall, type NoteItem, type SessionInfo, type StallState } from './api.ts';
import { CACHET_URL } from './signers.ts';

export const BrandMark = ({ id }: { id: 'a' | 'b' }) =>
  id === 'a' ? (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <rect x="3.5" y="2.5" width="15" height="17" rx="2.5" fill="var(--brand)" />
      <path d="M7 7.5h8M7 11h8M7 14.5h5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M3 8.5 5 3.5h12l2 5" stroke="var(--brand)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 8.5c0 1.4 1.1 2.5 2.7 2.5S8.3 9.9 8.3 8.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.7 2.5S19 9.9 19 8.5" fill="var(--brand)" />
      <path d="M4.5 11.5V18.5h13v-7M9 18.5v-4h4v4" stroke="var(--brand)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );

const ListingArt = ({ id }: { id: string }) =>
  id === 'notebook' ? (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5.5" y="3.5" width="13" height="17" rx="2" />
      <path d="M8.5 3.5v17M11.5 8.5h4M11.5 12h4" />
    </svg>
  ) : (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="10.5" r="5.5" />
      <path d="m9.8 10.6 1.5 1.5 3-3.2M12 16v4.5" />
    </svg>
  );

export const FieldnoteContent = ({ session }: { session: SessionInfo | null }) => {
  const [data, setData] = useState<{ locked: boolean; notes: NoteItem[] }>();
  useEffect(() => {
    let live = true;
    void getNotes()
      .then((d) => live && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [session?.pubkey, session?.checkedAt]);

  if (!data) {
    return (
      <div className="row muted" style={{ padding: '16px 0' }}>
        <Spinner /> Loading notes…
      </div>
    );
  }

  return (
    <div className="notes">
      {data.notes.map((n) => (
        <article key={n.id} className="note" data-locked={data.locked}>
          <div className="note__meta">
            <span>{n.date}</span>
            {data.locked && (
              <span className="note__lock">
                <IconLock size={13} /> Members
              </span>
            )}
          </div>
          <h3>{n.title}</h3>
          <p>{data.locked ? n.preview : n.body ?? n.preview}</p>
        </article>
      ))}
    </div>
  );
};

const CLOSED_REASONS: Record<string, string> = {
  withdrawn: 'seller withdrew this BCH link — checkout disabled',
  expired: 'seller’s BCH link expired — checkout disabled',
  unavailable: 'relays unreachable — could not verify seller right now',
  invalid: 'seller’s BCH proof failed verification — checkout disabled',
  not_found: 'no verified BCH link found for this seller',
};

export const StallContent = ({ session }: { session: SessionInfo | null }) => {
  const [stall, setStall] = useState<StallState>();
  const [selected, setSelected] = useState<string>();
  const [received, setReceived] = useState<IncomingPayment[]>([]);
  const [watching, setWatching] = useState<'connecting' | 'live' | 'off'>('connecting');
  const [rechecking, setRechecking] = useState(false);
  const [reload, setReload] = useState(0);
  const sellerQuery = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('seller') ?? undefined : undefined;

  useEffect(() => {
    let live = true;
    if (reload > 0) setRechecking(true);
    void getStall(sellerQuery)
      .then((d) => {
        if (!live) return;
        setStall(d);
        if (!d.seller) setSelected(undefined);
      })
      .catch(() => {})
      .finally(() => live && setRechecking(false));
    return () => {
      live = false;
    };
  }, [sellerQuery, session?.pubkey, session?.checkedAt, reload]);

  const sellerAddr = stall?.seller?.cashaddr;
  const isMainnet = !!sellerAddr && sellerAddr.startsWith('bitcoincash:');

  useEffect(() => {
    setReceived([]);
    if (!sellerAddr || !isMainnet) return;
    setWatching('connecting');
    const client = new ElectrumClient(DEFAULT_ELECTRUM);
    let stop: (() => void) | undefined;
    let live = true;
    watchAddress(client, sellerAddr, (p) =>
      setReceived((prev) => (prev.some((x) => x.txid === p.txid) ? prev.map((x) => (x.txid === p.txid ? p : x)) : [p, ...prev])),
    )
      .then((s) => (live ? ((stop = s), setWatching('live')) : s()))
      .catch(() => live && setWatching('off'));
    return () => {
      live = false;
      stop?.();
      client.close();
    };
  }, [sellerAddr, isMainnet]);

  if (!stall) {
    return (
      <div className="row muted" style={{ padding: '16px 0' }}>
        <Spinner /> Loading stall…
      </div>
    );
  }

  const seller = stall.seller;
  const item = stall.listings.find((l) => l.id === selected);
  const uri = seller && item ? paymentUri(seller.cashaddr, { sats: BigInt(item.sats), label: `Stall: ${item.name}` }) : undefined;
  const latest = received[0];

  return (
    <div className="stall">
      <div className="stall__payout">
        <span className="muted">Payouts go to</span>
        {seller ? (
          <span className="row" style={{ gap: 8 }}>
            <span className="mono">{shortCashaddr(seller.cashaddr, 10, 8)}</span>
            {sellerQuery ? (
              <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setReload((n) => n + 1)} disabled={rechecking}>
                {rechecking ? <Spinner /> : <IconRefresh size={13} />} Re-verify
              </button>
            ) : (
              session?.pubkey === seller.pubkey &&
              typeof window !== 'undefined' && <CopyChip value={`${window.location.origin}/?seller=${seller.npub}`} label="Share stall" />
            )}
          </span>
        ) : (
          <span className="row" style={{ gap: 8 }}>
            <span className="muted">
              {sellerQuery ? (CLOSED_REASONS[stall.sellerState ?? ''] ?? 'seller stall closed or expired') : 'sign in to set a verified BCH address'}
            </span>
            {sellerQuery && (
              <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setReload((n) => n + 1)} disabled={rechecking}>
                {rechecking ? <Spinner /> : <IconRefresh size={13} />} Re-verify
              </button>
            )}
          </span>
        )}
      </div>
      <div className="listings">
        {stall.listings.map((l) => {
          const active = selected === l.id && !!seller;
          return (
            <div key={l.id} className="listing-card">
              <div className="listing">
                <span className="listing__img">
                  <ListingArt id={l.id} />
                </span>
                <div>
                  <div className="listing__name">{l.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {l.stock} in stock · {l.sats.toLocaleString()} sats
                  </div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="listing__price">{l.bch} BCH</span>
                  {seller && (
                    <button
                      type="button"
                      className="c-btn c-btn--sm c-btn--secondary"
                      onClick={() => {
                        setReceived([]);
                        setSelected(active ? undefined : l.id);
                      }}
                    >
                      {active ? 'Close' : 'Checkout'}
                    </button>
                  )}
                </div>
              </div>
              {active && seller && uri && (
                <div className="stall__checkout">
                  <Qr value={uri} size={136} label={`Pay ${l.bch} BCH`} />
                  <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                    <div style={{ fontWeight: 550, fontSize: 14 }}>
                      Pay {l.sats.toLocaleString()} sats ({l.bch} BCH) directly to seller
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Verified for <span className="mono">{shortNpub(seller.pubkey)}</span>
                      {!isMainnet ? ' · chipnet address' : ' · non-custodial, 0% platform hold'}
                    </div>
                    <div className="row">
                      <a className="c-btn c-btn--sm brand-btn" href={uri}>
                        Open wallet <IconArrowUpRight size={13} />
                      </a>
                      {isMainnet && (
                        <a
                          className="c-btn c-btn--sm c-btn--secondary"
                          href={`${CACHET_URL}/p/${seller.npub}?amount=${encodeURIComponent(l.bch)}&address=${encodeURIComponent(seller.cashaddr)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Pay with WizardConnect <IconArrowUpRight size={13} />
                        </a>
                      )}
                      <CopyChip value={seller.cashaddr} label={shortCashaddr(seller.cashaddr, 8, 6)} />
                    </div>
                    {isMainnet &&
                      (latest ? (
                        <div className="stall__received">
                          <strong>
                            Payment to seller seen · {formatBch(latest.sats)} BCH
                          </strong>
                          <span>
                            {latest.confirmed ? 'Confirmed on-chain' : 'Broadcast · 0-conf seen'} ·{' '}
                            <a href={`https://blockchair.com/bitcoin-cash/transaction/${latest.txid}`} target="_blank" rel="noreferrer">
                              {shortMiddle(latest.txid, 10, 6)}
                            </a>
                          </span>
                        </div>
                      ) : (
                        <div className="stall__watch">
                          {watching === 'live' ? <span className="live" /> : null}
                          {watching === 'live'
                            ? 'Watching seller address on Fulcrum for instant 0-conf settlement'
                            : watching === 'connecting'
                              ? 'Connecting to Fulcrum…'
                              : 'Payment watcher offline; QR still works'}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {seller ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Buyers pay <span className="mono">{shortCashaddr(seller.cashaddr)}</span>, verified on relays for{' '}
          <span className="mono">{shortNpub(seller.pubkey)}</span>. Withdraw the link and Stall immediately disables checkout.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          No active verified seller right now. Sign in with your Cachet identity to open checkout.
        </p>
      )}
    </div>
  );
};
