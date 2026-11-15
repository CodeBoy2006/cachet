import { useEffect, useRef, useState } from 'react';
import { loadWalletConnect } from '@cachet/signers';
import { CopyChip, Dialog, Note, Qr, Spinner } from '@cachet/react';
import { config } from '../config.ts';

type WcSigner = Awaited<ReturnType<Awaited<ReturnType<typeof loadWalletConnect>>['init']>>;

export const WalletConnectDialog = ({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (signer: WcSigner, addresses: string[]) => void;
}) => {
  const [uri, setUri] = useState<string>();
  const [phase, setPhase] = useState<'init' | 'qr' | 'addresses' | 'error'>('init');
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (!open) {
      started.current = false;
      setUri(undefined);
      setPhase('init');
      setError(undefined);
      return;
    }
    if (started.current || !config.wcProjectId) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      try {
        const Wc = await loadWalletConnect();
        const signer = await Wc.init({ projectId: config.wcProjectId!, network: 'mainnet' });
        if (cancelled) return;
        if (!signer.connected) {
          const { uri, approved } = await signer.connect();
          approved.then(() => cancelled && void signer.disconnect()).catch(() => {});
          if (cancelled) return;
          setUri(uri);
          setPhase('qr');
          await approved;
        }
        if (cancelled) return;
        setPhase('addresses');
        const addresses = await signer.getAddresses();
        if (cancelled) return void signer.disconnect();
        if (!addresses.length) throw new Error('The wallet shared no BCH addresses.');
        onConnected(signer, addresses);
      } catch (e) {
        if (cancelled) return;
        setPhase('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onConnected]);

  return (
    <Dialog open={open} onClose={onClose} title="Connect a BCH wallet">
      {!config.wcProjectId ? (
        <Note tone="warn">This deployment has no WalletConnect project id. Use manual signing or a sandbox key.</Note>
      ) : phase === 'qr' && uri ? (
        <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
          <Qr value={uri} size={248} label="WalletConnect pairing code" />
          <p className="soft" style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>
            Scan with Paytaca or Zapit — or copy the pairing link to paste into Cashonize Web.
          </p>
          <CopyChip value={uri} label="Copy pairing link" title="Copy WalletConnect pairing URI" />
        </div>
      ) : phase === 'error' ? (
        <Note tone="danger">{error}</Note>
      ) : (
        <div className="row" style={{ justifyContent: 'center', padding: '32px 0', color: 'var(--ink-2)' }}>
          <Spinner /> {phase === 'addresses' ? 'Reading addresses from the wallet…' : 'Starting WalletConnect…'}
        </div>
      )}
    </Dialog>
  );
};
