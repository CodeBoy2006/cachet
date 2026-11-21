import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { hashTransaction, hexToBin } from '@bitauth/libauth';
import {
  DUST_SATS,
  InsufficientFundsError,
  ensureBroadcast,
  formatBch,
  lockingBytecodeOf,
  planPayment,
  toWcTransactionRequest,
  type ElectrumClient,
  type HdScanResult,
  type PaymentPlan,
  type WcTransactionRequest,
} from '@cachet/pay';
import { IconArrowUpRight, IconCheck, IconRefresh, IconWallet, Note, Spinner, shortMiddle } from '@cachet/react';
import { config } from '../config.ts';
import { WALLET_LOGOS, walletErrorText, type WalletBrand } from '../lib/wallets.ts';

export const WalletMark = ({ brand }: { brand?: WalletBrand }) => (
  <span className="wallet-mark" data-brand={brand}>
    {brand ? <img src={WALLET_LOGOS[brand]} alt="" decoding="async" draggable={false} /> : <IconWallet size={16} />}
  </span>
);

/** The frame every wallet state is drawn in, so connecting, paying and sent read as one object. */
export const WalletCard = ({
  brand,
  name,
  status,
  action,
  busy,
  children,
}: {
  brand?: WalletBrand;
  name: string;
  status: ReactNode;
  action?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
}) => (
  <div className="wallet-card" aria-busy={busy || undefined}>
    <div className="wallet-card__head">
      <WalletMark brand={brand} />
      <span className="wallet-card__id">
        <strong>{name}</strong>
        <small>{status}</small>
      </span>
      {action && <span className="wallet-card__actions">{action}</span>}
    </div>
    {children && <div className="wallet-card__body">{children}</div>}
  </div>
);

type Coins = { result?: HdScanResult; loading: boolean; error?: string };
type Send = { kind: 'idle' } | { kind: 'signing' } | { kind: 'sent'; txid: string } | { kind: 'error'; message: string };

/**
 * Pays from a connected wallet: reads its coins from Fulcrum, plans an unsigned
 * P2PKH transaction locally for whatever amount is chosen, asks the wallet to sign
 * and broadcast it, then confirms Fulcrum knows the exact txid.
 */
export const WalletPayment = ({
  brand,
  name,
  addresses,
  electrum,
  to,
  sats,
  payee,
  scan,
  sign,
  onDisconnect,
  onSent,
}: {
  brand?: WalletBrand;
  name: string;
  addresses?: readonly string[];
  electrum: ElectrumClient;
  to: string;
  sats: bigint;
  payee: string;
  /** Loads the wallet's spendable coins. A new function identity triggers a fresh scan. */
  scan: () => Promise<HdScanResult>;
  /** Asks the wallet to sign (and broadcast) the request; resolves to the signed transaction hex. */
  sign: (request: WcTransactionRequest, plan: PaymentPlan) => Promise<string>;
  onDisconnect: () => void;
  onSent: (txid: string, sats: bigint) => void;
}) => {
  const [coins, setCoins] = useState<Coins>({ loading: true });
  const [send, setSend] = useState<Send>({ kind: 'idle' });
  const [rescan, setRescan] = useState(0);
  const signing = send.kind === 'signing';

  // Keep the last balance on screen while refreshing; it is replaced, never mixed.
  useEffect(() => {
    let live = true;
    setCoins((c) => ({ result: c.result, loading: true }));
    scan().then(
      (result) => live && setCoins({ result, loading: false }),
      (e: unknown) => live && setCoins((c) => ({ result: c.result, loading: false, error: walletErrorText(e) })),
    );
    return () => {
      live = false;
    };
  }, [scan, rescan]);

  // A new amount or recipient starts a new payment.
  useEffect(() => {
    setSend((s) => (s.kind === 'signing' ? s : { kind: 'idle' }));
  }, [to, sats]);

  // The amount field explains an invalid amount; here it only disables sending.
  const hasAmount = sats >= DUST_SATS;

  const planned = useMemo((): { plan: PaymentPlan } | { error: unknown } | undefined => {
    if (!coins.result || coins.loading || !hasAmount) return undefined;
    try {
      return {
        plan: planPayment({
          utxos: coins.result.utxos,
          to: lockingBytecodeOf(to),
          sats,
          changeTo: lockingBytecodeOf(coins.result.changeAddress),
        }),
      };
    } catch (error) {
      return { error };
    }
  }, [coins, to, sats, hasAmount]);

  const plan = planned && 'plan' in planned ? planned.plan : undefined;
  const planError = planned && 'error' in planned ? planned.error : undefined;

  const pay = async () => {
    if (!plan) return;
    const paid = sats;
    setSend({ kind: 'signing' });
    try {
      const request = toWcTransactionRequest({ plan, broadcast: true, userPrompt: `Pay ${formatBch(paid)} BCH to ${payee}` });
      const signed = await sign(request, plan);
      const txid = hashTransaction(hexToBin(signed));
      await ensureBroadcast(electrum, signed, txid);
      setSend({ kind: 'sent', txid });
      onSent(txid, paid);
      setRescan((n) => n + 1);
    } catch (e) {
      setSend({ kind: 'error', message: walletErrorText(e) });
    }
  };

  const balance = coins.result?.balance;
  const status =
    balance !== undefined ? (
      <>
        <span className="wallet-card__balance">{formatBch(balance)} BCH</span> available
      </>
    ) : coins.loading ? (
      'Reading balance…'
    ) : (
      'Balance unavailable'
    );

  return (
    <WalletCard
      brand={brand}
      name={name}
      status={status}
      busy={coins.loading || signing}
      action={
        <>
          <button
            type="button"
            className="c-icon-btn wallet-card__refresh"
            onClick={() => setRescan((n) => n + 1)}
            disabled={coins.loading || signing}
            data-spin={coins.loading || undefined}
            aria-label="Refresh balance"
            title="Refresh balance"
          >
            <IconRefresh size={14} />
          </button>
          <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={onDisconnect} disabled={signing}>
            Disconnect
          </button>
        </>
      }
    >
      {!!addresses?.length && (
        <details className="wallet-card__addresses soft">
          <summary>{addresses.length === 1 ? 'Wallet address' : `Wallet addresses (${addresses.length})`}</summary>
          <ul className="mono">
            {addresses.map((address) => <li key={address}>{address}</li>)}
          </ul>
        </details>
      )}
      {coins.error && !coins.result ? (
        <Note tone="danger">
          {coins.error}{' '}
          <button type="button" className="c-link" onClick={() => setRescan((n) => n + 1)}>
            Try again
          </button>
        </Note>
      ) : planError instanceof InsufficientFundsError ? (
        <Note tone="warn">
          Needs {formatBch(planError.required)} BCH with the fee; {name} has {formatBch(planError.available)} BCH spendable.
        </Note>
      ) : planError ? (
        <Note tone="warn">{walletErrorText(planError)}</Note>
      ) : null}

      {send.kind === 'sent' ? (
        <div className="wallet-card__sent" role="status">
          <span className="signed-line">
            <IconCheck size={15} /> Sent
            <a className="mono" href={config.explorerTx(send.txid)} target="_blank" rel="noreferrer">
              {shortMiddle(send.txid, 10, 6)} <IconArrowUpRight size={12} />
            </a>
          </span>
          <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setSend({ kind: 'idle' })}>
            Send another
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="c-btn c-btn--accent c-btn--block c-btn--lg wallet-card__send"
          onClick={() => void pay()}
          disabled={!plan || signing}
          data-busy={signing || undefined}
        >
          {signing ? (
            <>
              <Spinner /> Confirm in {name}…
            </>
          ) : hasAmount ? (
            <>
              Send {formatBch(sats)} BCH
              {plan && <span className="wallet-card__fee">fee {plan.fee.toLocaleString()} sats</span>}
            </>
          ) : (
            'Choose an amount'
          )}
        </button>
      )}

      {send.kind === 'error' && <Note tone="danger">{send.message}</Note>}
    </WalletCard>
  );
};
