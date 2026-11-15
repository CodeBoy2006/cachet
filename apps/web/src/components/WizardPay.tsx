import { useEffect, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import {
  ensureBroadcast,
  formatBch,
  lockingBytecodeOf,
  planPayment,
  scanHdWallet,
  type ElectrumClient,
  type PaymentPlan,
} from '@cachet/pay';
import { hashTransaction, hexToBin } from '@bitauth/libauth';
import { IconArrowUpRight, IconCheck, IconWallet, Note, Spinner, shortMiddle } from '@cachet/react';
import { config } from '../config.ts';

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; plan: PaymentPlan; balance: bigint }
  | { kind: 'signing'; plan: PaymentPlan; balance: bigint }
  | { kind: 'sent'; txid: string }
  | { kind: 'error'; message: string };

/**
 * WizardConnect gives xpubs and transaction signing. We derive the wallet's
 * addresses, read UTXOs from Fulcrum, build the payment, and ask the wallet to
 * sign and broadcast it. The wallet shows the outputs before signing.
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
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (wc.state === 'connected') setDialog(false);
  }, [wc.state]);

  // Load spendable coins whenever the wallet (re)connects or the amount changes.
  useEffect(() => {
    const manager = wc.manager;
    if (wc.state !== 'connected' || !manager) return;
    let live = true;
    setPhase({ kind: 'loading' });
    (async () => {
      const { utxos, changeAddress, balance } = await scanHdWallet(electrum, (child, index) => manager.getPubkey(child, index));
      const plan = planPayment({ utxos, to: lockingBytecodeOf(to), sats, changeTo: lockingBytecodeOf(changeAddress) });
      if (live) setPhase({ kind: 'ready', plan, balance });
    })().catch((e) => live && setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [wc.state, wc.manager, electrum, to, sats, reload]);

  const send = async () => {
    if (phase.kind !== 'ready' || !wc.manager) return;
    const { plan, balance } = phase;
    setPhase({ kind: 'signing', plan, balance });
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
      setPhase({ kind: 'sent', txid });
      onSent(txid);
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
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
          <IconWallet /> Pay with WizardConnect
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

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row row--between" style={{ fontSize: 13.5 }}>
        <span className="soft">Connected to {wc.walletName ?? 'wallet'}</span>
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => void wc.disconnect()}>
          Disconnect
        </button>
      </div>
      {phase.kind === 'loading' && (
        <div className="row muted" style={{ fontSize: 13.5 }}>
          <Spinner /> Reading balance from Fulcrum…
        </div>
      )}
      {phase.kind === 'ready' && (
        <button type="button" className="c-btn c-btn--accent c-btn--block c-btn--lg" onClick={send}>
          Send {formatBch(sats)} BCH · fee {phase.plan.fee.toString()} sats
        </button>
      )}
      {phase.kind === 'signing' && (
        <button type="button" className="c-btn c-btn--block c-btn--lg" disabled>
          <Spinner /> Confirm in {wc.walletName ?? 'your wallet'}…
        </button>
      )}
      {phase.kind === 'sent' && (
        <div className="row row--between" style={{ fontSize: 13.5 }}>
          <span className="signed-line">
            <IconCheck size={15} /> Broadcast{' '}
            <a className="mono" href={config.explorerTx(phase.txid)} target="_blank" rel="noreferrer">
              {shortMiddle(phase.txid, 10, 6)} <IconArrowUpRight size={12} />
            </a>
          </span>
          <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setReload((n) => n + 1)}>
            Send another
          </button>
        </div>
      )}
      {phase.kind === 'error' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <Note tone="danger">{phase.message}</Note>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" style={{ justifySelf: 'start' }} onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
};
