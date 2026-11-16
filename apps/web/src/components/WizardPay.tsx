import { useCallback, useEffect, useState } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { scanHdWallet, type ElectrumClient, type PaymentPlan, type WcTransactionRequest } from '@cachet/pay';
import { Note, Spinner } from '@cachet/react';
import { KEYS } from '../lib/storage.ts';
import { brandOf } from '../lib/wallets.ts';
import { WalletCard, WalletPayment } from './WalletPayment.tsx';

const QR_THEME = {
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

/**
 * WizardConnect gives xpubs and transaction signing. We derive the wallet's
 * addresses, read its coins from Fulcrum, plan the payment locally and ask the
 * wallet to sign and broadcast it. The wallet shows the outputs before signing.
 */
export const WizardPay = ({
  electrum,
  to,
  sats,
  payee,
  autoOpen = false,
  onCancel,
  onSent,
}: {
  electrum: ElectrumClient;
  to: string;
  sats: bigint;
  payee: string;
  autoOpen?: boolean;
  onCancel: () => void;
  onSent: (txid: string, sats: bigint) => void;
}) => {
  const wc = useWizardConnect({ dappName: 'Cachet', sessionKey: KEYS.wizardSession });
  const [dialog, setDialog] = useState(false);
  const manager = wc.state === 'connected' ? wc.manager : null;

  const open = () => {
    if (wc.state === 'idle' || wc.state === 'disconnected') wc.connect();
    setDialog(true);
  };

  useEffect(() => {
    if (!autoOpen) return;
    // A macrotask lets StrictMode's throwaway mount cancel before a relay connection starts.
    const id = setTimeout(open, 0);
    return () => clearTimeout(id);
  }, [autoOpen]);

  useEffect(() => {
    if (wc.state === 'connected') setDialog(false);
  }, [wc.state]);

  const leave = () => {
    void wc.disconnect();
    onCancel();
  };

  const scan = useCallback(() => {
    if (!manager) return Promise.reject(new Error('Wallet is not connected'));
    return scanHdWallet(electrum, (child, index) => manager.getPubkey(child, index));
  }, [electrum, manager]);

  const sign = useCallback(
    async (request: WcTransactionRequest, plan: PaymentPlan) => {
      if (!manager) throw new Error('Wallet is not connected');
      const res = await manager.signTransaction({ transaction: request, inputPaths: plan.inputPaths });
      if (res.error || !res.signedTransaction) throw new Error(res.error ?? 'Declined in the wallet.');
      return res.signedTransaction;
    },
    [manager],
  );

  if (manager) {
    const name = wc.walletName ?? 'Selene';
    return (
      <WalletPayment
        brand={brandOf(name) ?? 'selene'}
        name={name}
        electrum={electrum}
        to={to}
        sats={sats}
        payee={payee}
        scan={scan}
        sign={sign}
        onDisconnect={leave}
        onSent={onSent}
      />
    );
  }

  const reconnecting = wc.state === 'reconnecting';
  const pairing = wc.state === 'connecting' && dialog;

  return (
    <>
      <WalletCard
        brand="selene"
        name="Selene"
        status={
          reconnecting ? (
            <>
              <Spinner /> Reconnecting…
            </>
          ) : pairing ? (
            'Waiting for the wallet…'
          ) : (
            'Not connected'
          )
        }
        action={
          <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={leave}>
            Cancel
          </button>
        }
      >
        {!reconnecting && !pairing && (
          <button type="button" className="c-btn c-btn--secondary c-btn--block" onClick={open}>
            {wc.state === 'connecting' ? 'Show pairing code' : 'Connect Selene'}
          </button>
        )}
        {wc.error && <Note tone="danger">{wc.error}</Note>}
      </WalletCard>
      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog
          show={dialog}
          onClose={() => {
            setDialog(false);
            leave();
          }}
          uri={wc.uri}
          qrUri={wc.qrUri}
          title="WizardConnect"
          subtitle="Scan with Selene or another WizardConnect wallet"
          theme={QR_THEME}
        />
      )}
    </>
  );
};
