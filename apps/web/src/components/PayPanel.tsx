import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DUST_SATS, ElectrumClient, formatBch, parseBch, paymentUri, watchAddress, type IncomingPayment } from '@cachet/pay';
import { CopyButton, IconArrowUpRight, IconCheck, IconChevronRight, Note, Qr, Segmented, Spinner, shortCashaddr, shortMiddle } from '@cachet/react';
import { config } from '../config.ts';
import { isSandboxAddress, useSession } from '../lib/session.tsx';
import { hasSavedWalletConnectSession, hasSavedWizardSession } from '../lib/storage.ts';
import { prefersReducedMotion } from '../lib/motion.ts';
import { KeysDialog } from './KeysDialog.tsx';
import type { WalletBrand } from '../lib/wallets.ts';
import { WalletCard, WalletMark } from './WalletPayment.tsx';

const WalletConnectPay = lazy(() => import('./WalletConnectPay.tsx').then((m) => ({ default: m.WalletConnectPay })));
const WizardPay = lazy(() => import('./WizardPay.tsx').then((m) => ({ default: m.WizardPay })));

const PRESETS = [
  { value: '0.00001', label: '1,000 sats' },
  { value: '0.0001', label: '10k sats' },
  { value: '0.001', label: '0.001 BCH' },
];

type WalletFlow = { kind: 'wc' | 'wizard'; autoOpen: boolean; restoreSaved?: boolean };

const WALLETS: { kind: WalletFlow['kind']; brand: WalletBrand; name: string; via: string; unavailable?: string }[] = [
  {
    kind: 'wc',
    brand: 'paytaca',
    name: 'Paytaca',
    via: 'WalletConnect',
    ...(config.wcProjectId ? {} : { unavailable: 'WalletConnect is not configured on this site. Scan the QR with Paytaca instead.' }),
  },
  { kind: 'wizard', brand: 'selene', name: 'Selene', via: 'WizardConnect' },
];

const initialFlow = (bchKind?: string): WalletFlow | null => {
  if (bchKind === 'walletconnect') return { kind: 'wc', autoOpen: false };
  if (config.wcProjectId && hasSavedWalletConnectSession()) return { kind: 'wc', autoOpen: false, restoreSaved: true };
  if (hasSavedWizardSession()) return { kind: 'wizard', autoOpen: false };
  return null;
};

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
    if (prefersReducedMotion()) {
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
  const { bch } = useSession();
  const init = useMemo(() => initialChoice(initialAmount), [initialAmount]);
  const [preset, setPreset] = useState(init.preset);
  const [custom, setCustom] = useState(init.custom);
  const [received, setReceived] = useState<IncomingPayment[]>([]);
  const [dismissedTxid, setDismissedTxid] = useState<string>();
  const [watching, setWatching] = useState<'connecting' | 'live' | 'off'>('connecting');
  const [keysOpen, setKeysOpen] = useState(false);
  const [walletFlow, setWalletFlow] = useState<WalletFlow | null>(() => initialFlow(bch?.kind));
  const electrum = useMemo(() => new ElectrumClient(config.electrum), []);
  const sandbox = useMemo(() => isSandboxAddress(cashaddr), [cashaddr]);

  useEffect(() => {
    if (bch?.kind === 'walletconnect') {
      setWalletFlow((prev) => (prev?.kind === 'wc' ? prev : { kind: 'wc', autoOpen: false }));
    }
  }, [bch?.kind]);

  const parsed = preset === 'custom' ? parseBch(custom) : parseBch(preset);
  const sats = parsed ?? 0n;
  const customError =
    preset !== 'custom' || !custom.trim()
      ? undefined
      : parsed === null
        ? 'Use a BCH amount like 0.0005, up to 8 decimals.'
        : sats < DUST_SATS
          ? `At least ${DUST_SATS} sats (${formatBch(DUST_SATS)} BCH).`
          : undefined;
  const payable = sats >= DUST_SATS && !customError;
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

  const onSent = (txid: string, paid: bigint) => {
    setDismissedTxid(undefined);
    setReceived((prev) => (prev.some((x) => x.txid === txid) ? prev : [{ txid, sats: paid, confirmed: false }, ...prev]));
  };

  const closeFlow = () => setWalletFlow(null);
  /** Shown while the wallet's SDK chunk downloads, in the same frame the flow will use. */
  const loading = (kind: WalletFlow['kind']): ReactNode => {
    const w = WALLETS.find((x) => x.kind === kind)!;
    return (
      <WalletCard
        brand={w.brand}
        name={w.name}
        status={
          <>
            <Spinner /> Loading {w.via}…
          </>
        }
      />
    );
  };

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
      <div className="pay__main">
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
              <span className="amount-input__unit">BCH</span>
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
                  <CopyButton value={cashaddr} label="Copy address" />
                </div>
              </div>
            </div>

            <div className="watch" data-state={watching}>
              {watching === 'live' ? <span className="live" /> : watching === 'connecting' ? <Spinner /> : null}
              <span>
                {watching === 'live'
                  ? `Listening for payment via ${server}`
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

        <div className="divider-label">or pay from a wallet</div>
        {walletFlow === null ? (
          <div className="pay__wallets" role="group" aria-label="Pay from a wallet">
            {WALLETS.map((w) => (
              <button
                key={w.kind}
                type="button"
                className="pay-wallet"
                disabled={!payable || !!w.unavailable}
                title={w.unavailable ?? (payable ? undefined : 'Choose an amount first')}
                onClick={() => setWalletFlow({ kind: w.kind, autoOpen: true })}
              >
                <WalletMark brand={w.brand} />
                <span className="pay-wallet__body">
                  <strong>{w.name}</strong>
                  <small>{w.unavailable ? 'Not configured' : w.via}</small>
                </span>
                <IconChevronRight size={14} className="pay-wallet__go" />
              </button>
            ))}
          </div>
        ) : walletFlow.kind === 'wc' ? (
          <Suspense fallback={loading('wc')}>
            <WalletConnectPay
              electrum={electrum}
              to={cashaddr}
              sats={payable ? sats : 0n}
              payee={payee}
              autoOpen={walletFlow.autoOpen}
              restoreSaved={Boolean(walletFlow.restoreSaved)}
              onCancel={closeFlow}
              onSent={onSent}
            />
          </Suspense>
        ) : (
          <Suspense fallback={loading('wizard')}>
            <WizardPay
              electrum={electrum}
              to={cashaddr}
              sats={payable ? sats : 0n}
              payee={payee}
              autoOpen={walletFlow.autoOpen}
              onCancel={closeFlow}
              onSent={onSent}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};
