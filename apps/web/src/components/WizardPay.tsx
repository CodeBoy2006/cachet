import { useEffect, useMemo, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import {
  ensureBroadcast,
  formatBch,
  lockingBytecodeOf,
  planPayment,
  scanHdWallet,
  type ElectrumClient,
  type HdScanResult,
  type PaymentPlan,
} from '@cachet/pay';
import { hashTransaction, hexToBin } from '@bitauth/libauth';
import { IconArrowUpRight, IconCheck, IconWallet, Note, Spinner, shortMiddle } from '@cachet/react';
import { config } from '../config.ts';

type Wallet = { kind: 'idle' } | { kind: 'scanning' } | { kind: 'ready'; scan: HdScanResult } | { kind: 'error'; message: string };
type Send = { kind: 'idle' } | { kind: 'signing' } | { kind: 'sent'; txid: string } | { kind: 'error'; message: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * WizardConnect gives xpubs and transaction signing. We derive the wallet's
 * addresses, read UTXOs from Fulcrum once per connection, plan the payment
 * locally for whatever amount is chosen, and ask the wallet to sign and
 * broadcast it. The wallet shows the outputs before signing.
 */
export const WizardPay = ({
  electrum,
  to,
  sats,
  payee,
  onSent,
}: {
  electrum: ElectrumClient;
  to: string;
  sats: bigint;
  payee: string;
  onSent: (txid: string) => void;
}) => {
  const wc = useWizardConnect({ dappName: 'Cachet', sessionKey: 'cachet-wizardconnect' });
  const [dialog, setDialog] = useState(false);
  const [wallet, setWallet] = useState<Wallet>({ kind: 'idle' });
  const [send, setSend] = useState<Send>({ kind: 'idle' });
  const [rescan, setRescan] = useState(0);

  useEffect(() => {
    if (wc.state === 'connected') setDialog(false);
  }, [wc.state]);

  // Scan the wallet's coins when it (re)connects, or after a payment.
  useEffect(() => {
    const manager = wc.manager;
    if (wc.state !== 'connected' || !manager) return setWallet({ kind: 'idle' });
    let live = true;
    setWallet({ kind: 'scanning' });
    scanHdWallet(electrum, (child, index) => manager.getPubkey(child, index))
      .then((scan) => live && setWallet({ kind: 'ready', scan }))
      .catch((e) => live && setWallet({ kind: 'error', message: message(e) }));
    return () => {
      live = false;
    };
  }, [wc.state, wc.manager, electrum, rescan]);

  // A new amount or recipient starts a new payment.
  useEffect(() => {
    setSend((s) => (s.kind === 'signing' ? s : { kind: 'idle' }));
  }, [to, sats]);

  const planned = useMemo((): { plan: PaymentPlan } | { error: string } | undefined => {
    if (wallet.kind !== 'ready') return undefined;
    try {
      return {
        plan: planPayment({ utxos: wallet.scan.utxos, to: lockingBytecodeOf(to), sats, changeTo: lockingBytecodeOf(wallet.scan.changeAddress) }),
      };
    } catch (e) {
      return { error: message(e) };
    }
  }, [wallet, to, sats]);

  const pay = async () => {
    if (!planned || !('plan' in planned) || !wc.manager) return;
    const { plan } = planned;
    setSend({ kind: 'signing' });
    try {
      const res = await wc.manager.signTransaction({
        transaction: {
          transaction: plan.transaction,
          sourceOutputs: plan.sourceOutputs,
          broadcast: true,
          userPrompt: `Pay ${formatBch(sats)} BCH to ${payee}`,
        },
        inputPaths: plan.inputPaths,
      });
      if (res.error || !res.signedTransaction) throw new Error(res.error ?? 'The wallet declined.');
      const txid = hashTransaction(hexToBin(res.signedTransaction));
      await ensureBroadcast(electrum, res.signedTransaction, txid);
      setSend({ kind: 'sent', txid });
      onSent(txid);
    } catch (e) {
      setSend({ kind: 'error', message: message(e) });
    }
  };

  const theme = {
    backdropColor: 'rgb(14 14 13 / 0.38)',
    dialogBackground: 'var(--surface)',
    headerBackground: 'var(--surface)',
    titleColor: 'var(--ink)',
    subtitleColor: 'var(--ink-3)',
    uriRowBackground: 'var(--surface-2)',
    uriTextColor: 'var(--ink-2)',
    borderColor: 'var(--line)',
    closeButtonColor: 'var(--ink-3)',
    copyButtonColor: 'var(--ink-3)',
    qrForeground: '#111',
    qrBackground: '#fff',
    qrSize: 248,
  };

  if (wc.state !== 'connected') {
    const connecting = wc.state === 'connecting' || wc.state === 'reconnecting';
    return (
      <>
        <button
          type="button"
          className="c-btn c-btn--secondary c-btn--block"
          onClick={() => {
            if (wc.state === 'idle' || wc.state === 'disconnected') wc.connect();
            setDialog(true);
          }}
        >
          {connecting && dialog ? <Spinner /> : <IconWallet />} Pay with WizardConnect
        </button>
        {wc.uri && wc.qrUri && (
          <WizardConnectQRDialog
            show={dialog}
            onClose={() => {
              setDialog(false);
              void wc.disconnect();
            }}
            uri={wc.uri}
            qrUri={wc.qrUri}
            title="WizardConnect"
            subtitle="Scan with Selene or another WizardConnect wallet"
            theme={theme}
          />
        )}
        {wc.error && <Note tone="danger">{wc.error}</Note>}
      </>
    );
  }

  const balance = wallet.kind === 'ready' ? wallet.scan.balance : undefined;

  return (
    <div className="wizard">
      <div className="wizard__head">
        <span className="soft">
          {wc.walletName ?? 'Wallet'} connected
          {balance !== undefined && <span className="muted"> · {formatBch(balance)} BCH available</span>}
        </span>
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => void wc.disconnect()} disabled={send.kind === 'signing'}>
          Disconnect
        </button>
      </div>

      {wallet.kind === 'scanning' && (
        <div className="row muted wizard__line">
          <Spinner /> Reading balance from Fulcrum…
        </div>
      )}

      {wallet.kind === 'error' && (
        <div className="wizard__stack">
          <Note tone="danger">{wallet.message}</Note>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => setRescan((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {wallet.kind === 'ready' && planned && 'error' in planned && send.kind !== 'sent' && <Note tone="warn">{planned.error}</Note>}

      {wallet.kind === 'ready' && planned && 'plan' in planned && (send.kind === 'idle' || send.kind === 'error') && (
        <button type="button" className="c-btn c-btn--accent c-btn--block c-btn--lg" onClick={pay}>
          Send {formatBch(sats)} BCH
          <span className="wizard__fee">fee {planned.plan.fee.toString()} sats</span>
        </button>
      )}

      {send.kind === 'signing' && (
        <button type="button" className="c-btn c-btn--block c-btn--lg" disabled>
          <Spinner /> Confirm in {wc.walletName ?? 'your wallet'}…
        </button>
      )}

      {send.kind === 'error' && <Note tone="danger">{send.message}</Note>}

      {send.kind === 'sent' && (
        <div className="wizard__sent">
          <span className="signed-line">
            <IconCheck size={15} /> Broadcast{' '}
            <a className="mono" href={config.explorerTx(send.txid)} target="_blank" rel="noreferrer">
              {shortMiddle(send.txid, 10, 6)} <IconArrowUpRight size={12} />
            </a>
          </span>
          <button
            type="button"
            className="c-btn c-btn--ghost c-btn--sm"
            onClick={() => {
              setSend({ kind: 'idle' });
              setRescan((n) => n + 1);
            }}
          >
            Send another
          </button>
        </div>
      )}
    </div>
  );
};
