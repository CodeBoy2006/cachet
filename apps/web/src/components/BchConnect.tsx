import { useCallback, useState } from 'react';
import { isAddressError, normalizeCashAddrInput } from '@cachet/core';
import { IconKey, IconPen, IconWallet, Note } from '@cachet/react';
import { config } from '../config.ts';
import { useSession } from '../lib/session.tsx';
import { WalletConnectDialog } from './WalletConnectDialog.tsx';

export const BchConnect = () => {
  const { setBch, sandboxBch } = useSession();
  const [wcOpen, setWcOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();

  const onConnected = useCallback(
    (signer: Parameters<React.ComponentProps<typeof WalletConnectDialog>['onConnected']>[0], addresses: string[]) => {
      setWcOpen(false);
      setBch({ kind: 'walletconnect', label: signer.label, signer, addresses });
      signer.onAddressesChanged((next) => setBch({ kind: 'walletconnect', label: signer.label, signer, addresses: next }));
      signer.onDisconnect(() => setBch(undefined));
    },
    [setBch],
  );

  const useManual = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = normalizeCashAddrInput(input);
    if (isAddressError(parsed)) return setError(`That is not a valid CashAddr (${parsed.detail}).`);
    if (!parsed.singleKey) return setError('Multisig and contract (P2SH) addresses cannot sign messages. Use a regular wallet address.');
    if (parsed.network === 'regtest') return setError('Regtest addresses are not supported.');
    setBch({ kind: 'manual', label: 'Manual signing', addresses: [parsed.address] });
  };

  return (
    <>
      <div className="options">
        <button
          type="button"
          className="option"
          onClick={() => setWcOpen(true)}
          disabled={!config.wcProjectId}
          title={config.wcProjectId ? undefined : 'Set VITE_WC_PROJECT_ID in apps/web/.env to enable WalletConnect'}
        >
          <span className="option__icon">
            <IconWallet />
          </span>
          <span>
            <strong>WalletConnect</strong>
            <small>Paytaca, Cashonize, Zapit — signs with bch_signMessage</small>
          </span>
          <span className="option__meta">{config.wcProjectId ? 'QR' : 'Not configured'}</span>
        </button>
        <button type="button" className="option" onClick={() => setManual(!manual)} aria-expanded={manual}>
          <span className="option__icon">
            <IconPen />
          </span>
          <span>
            <strong>Sign manually</strong>
            <small>Electron Cash or any wallet with “Sign message”</small>
          </span>
          <span className="option__meta">Copy · paste</span>
        </button>
        {manual && (
          <form onSubmit={useManual} className="row" style={{ padding: '4px 0 6px' }}>
            <input
              className="c-input mono"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="bitcoincash:q…"
              value={input}
              onChange={(e) => (setInput(e.target.value), setError(undefined))}
              spellCheck={false}
              autoFocus
            />
            <button className="c-btn" type="submit">
              Use address
            </button>
          </form>
        )}
        <button
          type="button"
          className="option"
          onClick={() => {
            const s = sandboxBch();
            setBch({ kind: 'local', label: 'Sandbox key', signer: s, addresses: [s.address()] });
          }}
        >
          <span className="option__icon">
            <IconKey />
          </span>
          <span>
            <strong>Sandbox key</strong>
            <small>A real mainnet key held in this browser. Export it before sending funds.</small>
          </span>
          <span className="option__meta">Instant</span>
        </button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <WalletConnectDialog open={wcOpen} onClose={() => setWcOpen(false)} onConnected={onConnected} />
    </>
  );
};
