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

/** Smooth ease-out counter roll when a 0-conf payment receipt lands. */
const useCountUpSats = (target?: bigint) => {
  const [shown, setShown] = useState<bigint>(target ?? 0n);
  useEffect(() => {
    if (target === undefined) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return;
    }
    const total = Number(target);
    if (!Number.isSafeInteger(total) || total <= 0) {
      setShown(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const duration = 420;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - p) ** 3;
      setShown(BigInt(Math.round(total * eased)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
};

export const PayPanel = ({ cashaddr, payee, initialAmount }: { cashaddr: string; payee: string; initialAmount?: string }) => {
  const init = useMemo(() => initialChoice(initialAmount), [initialAmount]);
  const [preset, setPreset] = useState(init.preset);
  const [custom, setCustom] = useState(init.custom);
  const [received, setReceived] = useState<IncomingPayment[]>([]);
  const [dismissedTxid, setDismissedTxid] = useState<string>();
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
    setDismissedTxid(undefined);
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
  const activeReceipt = latest && latest.txid !== dismissedTxid ? latest : undefined;
  const animatedSats = useCountUpSats(activeReceipt?.sats);
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

      {activeReceipt ? (
        <div className="pay-receipt" key={activeReceipt.txid} role="status" aria-live="polite">
          <span className="pay-receipt__sweep" aria-hidden />
          <div className="pay-receipt__top">
            <span className="received__mark">
              <IconCheck size={17} strokeWidth={2.3} />
            </span>
            <div className="pay-receipt__body">
              <div className="pay-receipt__amount">
                {formatBch(animatedSats)}
                <small>BCH received</small>
              </div>
              <div className="pay-receipt__meta">
                <span className="pay-receipt__pill" data-confirmed={activeReceipt.confirmed || undefined}>
                  {activeReceipt.confirmed ? 'Confirmed' : '0-conf · in mempool'}
                </span>
                <span>{animatedSats.toLocaleString()} sats</span>
                <a href={config.explorerTx(activeReceipt.txid)} target="_blank" rel="noreferrer">
                  {shortMiddle(activeReceipt.txid, 10, 6)} <IconArrowUpRight size={12} />
                </a>
              </div>
            </div>
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => setDismissedTxid(activeReceipt.txid)}>
              Pay again
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pay__qr">
            <a
              href={uri}
              className="pay__qr-code"
              aria-label="Open in a BCH wallet"
              data-dim={!payable || undefined}
              data-live={(watching === 'live' && payable) || undefined}
            >
              <span className="pay__qr-frame">
                <span className="pay__qr-corners" aria-hidden />
                <Qr value={uri} size={168} label="Payment request" />
              </span>
            </a>
            <div className="pay__summary">
              <div className="amount" key={payable ? String(sats) : 'empty'}>
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

          <div className="watch" data-state={watching}>
            {watching === 'live' ? <span className="live" /> : watching === 'connecting' ? <Spinner /> : null}
            <span>
              {watching === 'live'
                ? `Watching via ${server} · instant 0-conf`
                : watching === 'connecting'
                  ? 'Connecting to Fulcrum…'
                  : 'Payment watcher offline. The QR still works.'}
            </span>
            {latest && (
              <button type="button" className="c-link watch__last" onClick={() => setDismissedTxid(undefined)}>
                Last receipt ({formatBch(latest.sats)} BCH)
              </button>
            )}
          </div>
        </>
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
            onSent={(txid) => {
              setDismissedTxid(undefined);
              setReceived((prev) => (prev.some((x) => x.txid === txid) ? prev : [{ txid, sats, confirmed: false }, ...prev]));
            }}
          />
        </Suspense>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          Choose an amount first.
        </p>
      )}
    </div>
  );
};
