import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ElectrumClient, formatBch, parseBch, paymentUri, watchAddress, type IncomingPayment } from '@cachet/pay';
import { CopyChip, IconArrowUpRight, IconCheck, Note, Qr, Segmented, Spinner, shortCashaddr, shortMiddle } from '@cachet/react';
import { config } from '../config.ts';
import { isSandboxAddress } from '../lib/session.tsx';
import { KeysDialog } from './KeysDialog.tsx';

const WizardPay = lazy(() => import('./WizardPay.tsx').then((m) => ({ default: m.WizardPay })));

const PRESETS = [
  { value: '0.00001', label: '1,000 sats' },
  { value: '0.0001', label: '10k sats' },
  { value: '0.001', label: '0.001 BCH' },
];

/** Below the dust limit no wallet will build the output. */
const DUST = 546n;

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
  const sandbox = useMemo(() => isSandboxAddress(cashaddr), [cashaddr]);

  const parsed = preset === 'custom' ? parseBch(custom) : parseBch(preset);
  const sats = parsed ?? 0n;
  const customError =
    preset !== 'custom' || !custom.trim()
      ? undefined
      : parsed === null
        ? 'Use a BCH amount like 0.0005, up to 8 decimals.'
        : sats < DUST
          ? `At least ${DUST} sats (${formatBch(DUST)} BCH).`
          : undefined;
  const payable = sats >= DUST && !customError;
  const uri = paymentUri(cashaddr, { ...(payable ? { sats } : {}), label: payee.slice(0, 64) });

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
  const server = electrum.server?.replace(/^wss?:\/\//, '').split(':')[0];

  return (
    <div className="pay">
      {sandbox && (
        <>
          <Note tone="warn">
            This address belongs to a sandbox key in this browser.{' '}
            <button type="button" className="c-link" onClick={() => setKeysOpen(true)}>
              Back up the WIF key
            </button>{' '}
            before sending real BCH.
          </Note>
          <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
        </>
      )}
      <div className="pay__amounts">
        <Segmented value={preset} options={[...PRESETS, { value: 'custom', label: 'Other' }]} onChange={setPreset} label="Amount" />
        {preset === 'custom' && (
          <span className="amount-input">
            <input
              className="c-input"
              aria-label="Custom amount in BCH"
              aria-invalid={!!customError || undefined}
              inputMode="decimal"
              placeholder="0.0005"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(',', '.'))}
              autoFocus
            />
            <span className="muted">BCH</span>
          </span>
        )}
      </div>
      {customError && <span className="field-error">{customError}</span>}

      <div className="pay__qr">
        <a href={uri} className="pay__qr-code" aria-label="Open in a BCH wallet" data-dim={!payable || undefined}>
          <Qr value={uri} size={168} label="Payment request" />
        </a>
        <div className="pay__summary">
          <div className="amount">
            {payable ? formatBch(sats) : '—'}
            <small>BCH</small>
          </div>
          <div className="pay__meta">
            {payable && <span>{sats.toLocaleString()} sats</span>}
            <span>
              to {payee} · <span className="mono">{shortCashaddr(cashaddr)}</span>
            </span>
          </div>
          <div className="row">
            <a className="c-btn c-btn--sm" href={uri} aria-disabled={!payable || undefined} onClick={(e) => !payable && e.preventDefault()}>
              Open wallet <IconArrowUpRight size={13} />
            </a>
            <CopyChip value={cashaddr} label="Copy address" />
          </div>
        </div>
      </div>

      {latest ? (
        <div className="received" key={latest.txid}>
          <span className="received__mark">
            <IconCheck size={16} strokeWidth={2.2} />
          </span>
          <div>
            <strong>Received {formatBch(latest.sats)} BCH</strong>
            <span>
              {latest.confirmed ? 'Confirmed' : 'Seen in mempool'} ·{' '}
              <a href={config.explorerTx(latest.txid)} target="_blank" rel="noreferrer">
                {shortMiddle(latest.txid, 10, 6)}
              </a>
            </span>
          </div>
        </div>
      ) : (
        <div className="watch" data-state={watching}>
          {watching === 'live' ? <span className="live" /> : watching === 'connecting' ? <Spinner /> : null}
          {watching === 'live'
            ? `Watching for payments via ${server}`
            : watching === 'connecting'
              ? 'Connecting to Fulcrum…'
              : 'Payment watcher offline. The QR still works.'}
        </div>
      )}

      <div className="divider-label">or pay from Selene</div>
      {payable ? (
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
          Choose an amount first.
        </p>
      )}
    </div>
  );
};
