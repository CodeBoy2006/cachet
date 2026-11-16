import { useEffect, useRef, useState } from 'react';
import { loadWalletConnect } from '@cachet/signers';
import { CopyChip, Dialog, Note, Qr, Spinner } from '@cachet/react';
import { config } from '../config.ts';

export type WcSigner = Awaited<ReturnType<Awaited<ReturnType<typeof loadWalletConnect>>['init']>>;

/** One SignClient per page: initialising it twice (StrictMode, reopening the dialog) duplicates relay sockets. */
let shared: Promise<WcSigner> | undefined;
export const getWalletConnectSigner = () => {
  shared ??= loadWalletConnect()
    .then((Wc) => Wc.init({ projectId: config.wcProjectId!, network: 'mainnet' }))
    .catch((e: unknown) => {
      shared = undefined;
      throw e;
    });
  return shared;
};

type Phase = 'init' | 'qr' | 'addresses' | 'error';

export const WalletConnectDialog = ({
  open,
  onClose,
  onConnected,
  fallbackNote = 'This deployment has no WalletConnect project id. Use manual signing or a sandbox key.',
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (signer: WcSigner, addresses: string[]) => void;
  fallbackNote?: string;
}) => {
  const [uri, setUri] = useState<string>();
  const [phase, setPhase] = useState<Phase>('init');
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  // Pairing must not restart because a parent re-rendered with a new callback.
  const connected = useRef(onConnected);
  useEffect(() => {
    connected.current = onConnected;
  });

  useEffect(() => {
    if (!open || !config.wcProjectId) return;
    let cancelled = false;
    setUri(undefined);
    setPhase('init');
    setError(undefined);
    (async () => {
      try {
        const signer = await getWalletConnectSigner();
        if (cancelled) return;
        if (!signer.connected) {
          const { uri, approved } = await signer.connect();
          // If the dialog closed while the wallet was still deciding, do not leave a dangling session.
          approved.then(() => cancelled && void signer.disconnect()).catch(() => {});
          if (cancelled) return;
          setUri(uri);
          setPhase('qr');
          await approved;
        }
        if (cancelled) return;
        setPhase('addresses');
        const addresses = await signer.getAddresses();
        if (cancelled) return;
        if (!addresses.length) throw new Error('The wallet shared no BCH addresses.');
        connected.current(signer, addresses);
      } catch (e) {
        if (cancelled) return;
        setPhase('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  return (
    <Dialog open={open} onClose={onClose} title="Connect a BCH wallet">
      {!config.wcProjectId ? (
        <Note tone="warn">{fallbackNote}</Note>
      ) : phase === 'qr' && uri ? (
        <div className="wc-pair">
          <a href={uri} className="wc-pair__qr" aria-label="Open in a wallet on this device">
            <Qr value={uri} size={248} label="WalletConnect pairing code" />
          </a>
          <p className="soft">Scan with Paytaca or Zapit, or paste the pairing link into Cashonize.</p>
          <CopyChip value={uri} label="Copy pairing link" title="Copy WalletConnect pairing URI" />
        </div>
      ) : phase === 'error' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <Note tone="danger">{error}</Note>
          <button type="button" className="c-btn c-btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <div className="row muted" style={{ justifyContent: 'center', padding: '40px 0' }}>
          <Spinner /> {phase === 'addresses' ? 'Reading addresses from the wallet…' : 'Starting WalletConnect…'}
        </div>
      )}
    </Dialog>
  );
};
