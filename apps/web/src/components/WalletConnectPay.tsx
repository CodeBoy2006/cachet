import { useCallback, useEffect, useRef, useState } from 'react';
import { scanAddressWallet, type ElectrumClient, type WcTransactionRequest } from '@cachet/pay';
import { Spinner } from '@cachet/react';
import { config } from '../config.ts';
import { useSession } from '../lib/session.tsx';
import { WalletConnectDialog, getWalletConnectSigner, type WcSigner } from './WalletConnectDialog.tsx';
import { brandOf } from '../lib/wallets.ts';
import { WalletCard, WalletPayment } from './WalletPayment.tsx';

/**
 * BCH WalletConnect v2 (`wc2-bch-bcr`) payment for Paytaca, Cashonize and Zapit.
 * Reuses the session's wallet when one is connected (for example from /new), or
 * resumes a saved pairing on reload, then pays with `bch_signTransaction`.
 */
export const WalletConnectPay = ({
  electrum,
  to,
  sats,
  payee,
  autoOpen = false,
  restoreSaved = false,
  onCancel,
  onSent,
}: {
  electrum: ElectrumClient;
  to: string;
  sats: bigint;
  payee: string;
  autoOpen?: boolean;
  restoreSaved?: boolean;
  onCancel: () => void;
  onSent: (txid: string, sats: bigint) => void;
}) => {
  const { bch, setBch } = useSession();
  const active = bch?.kind === 'walletconnect' && bch.signer?.signTransaction ? bch : undefined;
  const [dialog, setDialog] = useState(() => autoOpen && !active);
  const [restoring, setRestoring] = useState(() => restoreSaved && !active && Boolean(config.wcProjectId));
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });

  // Resume a persisted pairing without showing a new QR. Runs once per mount.
  useEffect(() => {
    if (!restoring) return;
    let live = true;
    (async () => {
      try {
        const signer = await getWalletConnectSigner();
        const addresses = signer.connected ? await signer.getAddresses() : [];
        if (!live) return;
        if (addresses.length) setBch({ kind: 'walletconnect', label: signer.label, signer, addresses });
        else cancel.current();
      } catch {
        if (live) cancel.current();
      } finally {
        if (live) setRestoring(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const onConnected = (signer: WcSigner, addresses: string[]) => {
    setDialog(false);
    setBch({ kind: 'walletconnect', label: signer.label, signer, addresses });
  };

  const addressKey = active?.addresses.join(' ') ?? '';
  const scan = useCallback(() => scanAddressWallet(electrum, addressKey.split(' ')), [electrum, addressKey]);
  const signer = active?.signer;
  const sign = useCallback(
    async (request: WcTransactionRequest) => {
      if (!signer?.signTransaction) throw new Error('Wallet is not connected');
      return (await signer.signTransaction(request)).signedTransaction;
    },
    [signer],
  );

  if (active) {
    const name = active.label === 'WalletConnect' ? 'Paytaca' : active.label;
    return (
      <WalletPayment
        brand={brandOf(name)}
        name={name}
        electrum={electrum}
        to={to}
        sats={sats}
        payee={payee}
        scan={scan}
        sign={sign}
        onDisconnect={() => {
          setBch(undefined);
          onCancel();
        }}
        onSent={onSent}
      />
    );
  }

  return (
    <>
      <WalletCard
        brand="paytaca"
        name="Paytaca"
        status={
          restoring ? (
            <>
              <Spinner /> Reconnecting…
            </>
          ) : (
            'Waiting for the wallet…'
          )
        }
        action={
          <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={onCancel}>
            Cancel
          </button>
        }
      >
        {!restoring && !dialog && (
          <button type="button" className="c-btn c-btn--secondary c-btn--block" onClick={() => setDialog(true)}>
            Show pairing code
          </button>
        )}
      </WalletCard>
      <WalletConnectDialog
        open={dialog}
        onClose={() => {
          setDialog(false);
          onCancel();
        }}
        onConnected={onConnected}
        fallbackNote="This deployment has no WalletConnect project id. Scan the payment QR with Paytaca instead, or set VITE_WC_PROJECT_ID in apps/web/.env."
      />
    </>
  );
};
