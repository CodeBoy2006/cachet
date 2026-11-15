import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ElectrumClient, formatBch, parseBch, paymentUri, watchAddress, type IncomingPayment } from '@cachet/pay';
import { CopyChip, IconArrowUpRight, Note, Qr, Segmented, Spinner, shortCashaddr, shortMiddle } from '@cachet/react';
import { config } from '../config.ts';
import { isSandboxAddress } from '../lib/session.tsx';
import { KeysDialog } from './KeysDialog.tsx';

const WizardPay = lazy(() => import('./WizardPay.tsx').then((m) => ({ default: m.WizardPay })));

const PRESETS = [
  { value: '0.00001', label: '1,000 sats' },
  { value: '0.0001', label: '10k sats' },
  { value: '0.001', label: '0.001 BCH' },
];

const initialChoice = (raw?: string): { preset: string; custom: string } => {
  const sats = raw ? parseBch(raw) : null;
  if (!sats || sats <= 0n) return { preset: '0.00001', custom: '' };
  const normalized = formatBch(sats);
  return PRESETS.some((p) => p.value === normalized) ? { preset: normalized, custom: '' } : { preset: 'custom', custom: normalized };
};

export const PayPanel = ({ cashaddr, payee, initialAmount }: { cashaddr: string; payee: string; initialAmount?: string }) => {
  const init = useMemo(() => initialChoice(initialAmount), [initialAmount]);
  const [preset, setPreset] = useState(init.preset);
  const [custom, setCustom] = useState(init.custom);
  const [received, setReceived] = useState<IncomingPayment[]>([]);
  const [watching, setWatching] = useState<'connecting' | 'live' | 'off'>('connecting');
  const [keysOpen, setKeysOpen] = useState(false);
  const electrum = useMemo(() => new ElectrumClient(config.electrum), []);

  const sats = (preset === 'custom' ? parseBch(custom) : parseBch(preset)) ?? 0n;
  const uri = paymentUri(cashaddr, { sats, label: payee.slice(0, 64) });

  useEffect(() => {
    setReceived([]);
    setWatching('connecting');
    let stop: (() => void) | undefined;
    let live = true;
    watchAddress(electrum, cashaddr, (p) =>
      setReceived((prev) => (prev.some((x) => x.txid === p.txid) ? prev.map((x) => (x.txid === p.txid ? p : x)) : [p, ...prev])),
    )
      .then((s) => (live ? ((stop = s), setWatching('live')) : s()))
      .catch(() => live && setWatching('off'));
    return () => {
      live = false;
      stop?.();
    };
  }, [electrum, cashaddr]);

  useEffect(() => () => electrum.close(), [electrum]);

  const latest = received[0];

  return (
    <div className="pay">
      {isSandboxAddress(cashaddr) && (
        <>
          <Note tone="warn">
            This address belongs to a sandbox key in this browser.{' '}
            <button
              type="button"
              onClick={() => setKeysOpen(true)}
              style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', fontWeight: 550 }}
            >
              Back up the WIF key
            </button>{' '}
            before sending real BCH.
          </Note>
          <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
        </>
      )}
      <div className="row row--between">
        <Segmented
          value={preset}
          options={[...PRESETS, { value: 'custom', label: 'Other' }]}
          onChange={setPreset}
          label="Amount in BCH"
        />
        {preset === 'custom' && (
          <span className="amount-input">
            <input
              className="c-input"
              aria-label="Custom amount in BCH"
              inputMode="decimal"
              placeholder="0.0005"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              autoFocus
            />
            <span className="muted">BCH</span>
          </span>
        )}
      </div>

      <div className="pay__qr">
        <a href={uri} aria-label="Open in a BCH wallet">
          <Qr value={uri} size={168} label="Payment request" />
        </a>
        <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          <div className="amount">
            {sats > 0n ? formatBch(sats) : '—'}
            <small>BCH</small>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {sats > 0n ? `${sats.toLocaleString()} sats · ` : ''}to {payee} · {shortCashaddr(cashaddr)}
          </div>
          <div className="row">
            <a className="c-btn c-btn--sm" href={uri}>
              Open wallet <IconArrowUpRight size={13} />
            </a>
            <CopyChip value={cashaddr} label="Copy address" />
          </div>
        </div>
      </div>

      {latest ? (
        <div className="received">
          <strong>Received {formatBch(latest.sats)} BCH</strong>
          <span style={{ fontSize: 13 }}>
            {latest.confirmed ? 'Confirmed on-chain' : 'Broadcast · 0-conf seen'} ·{' '}
            <a href={config.explorerTx(latest.txid)} target="_blank" rel="noreferrer">
              {shortMiddle(latest.txid, 10, 6)}
            </a>
          </span>
          <span style={{ fontSize: 12.5, opacity: 0.9 }}>Supporter receipt verified on Bitcoin Cash mainnet for {payee}.</span>
        </div>
      ) : (
        <div className="watch">
          {watching === 'live' ? <span className="live" /> : null}
          {watching === 'live'
            ? `Watching for payments via ${electrum.server?.replace('wss://', '').split(':')[0]}`
            : watching === 'connecting'
              ? 'Connecting to Fulcrum…'
              : 'Payment watcher offline; the QR still works.'}
        </div>
      )}

      <div className="divider-label">or connect Selene / WizardConnect</div>
      {sats > 0n ? (
        <Suspense
          fallback={
            <div className="row muted" style={{ fontSize: 13.5 }}>
              <Spinner /> Loading WizardConnect…
            </div>
          }
        >
          <WizardPay
            electrum={electrum}
            to={cashaddr}
            sats={sats}
            payee={payee}
            onSent={(txid) => setReceived((prev) => (prev.some((x) => x.txid === txid) ? prev : [{ txid, sats, confirmed: false }, ...prev]))}
          />
        </Suspense>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Enter an amount first.
        </p>
      )}
    </div>
  );
};
