import { useCallback, useEffect, useRef, useState } from 'react';
import { isAddressError, normalizeCashAddrInput } from '@cachet/core';
import { IconChevron, IconKey, IconPen, IconWallet, Note } from '@cachet/react';
import { config } from '../config.ts';
import { useSession } from '../lib/session.tsx';
import { WalletConnectDialog } from './WalletConnectDialog.tsx';

type WcSigner = Parameters<React.ComponentProps<typeof WalletConnectDialog>['onConnected']>[0];

export const BchConnect = () => {
  const { setBch, sandboxBch } = useSession();
  const [wcOpen, setWcOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>();
  const unsubscribe = useRef<(() => void)[]>([]);

  const onConnected = useCallback(
    (signer: WcSigner, addresses: string[]) => {
      setWcOpen(false);
      // The signer is shared across connections; drop listeners from an earlier one.
      unsubscribe.current.forEach((u) => u());
      setBch({ kind: 'walletconnect', label: signer.label, signer, addresses });
      unsubscribe.current = [
        signer.onAddressesChanged((next) => setBch({ kind: 'walletconnect', label: signer.label, signer, addresses: next })),
        signer.onDisconnect(() => setBch(undefined)),
      ];
    },
    [setBch],
  );

  useEffect(() => () => unsubscribe.current.forEach((u) => u()), []);

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
            <small>Paytaca, Cashonize, Zapit</small>
          </span>
          <span className="option__meta">{config.wcProjectId ? 'QR' : 'Not configured'}</span>
        </button>
        <div className="option-group" data-open={manual}>
          <button type="button" className="option" onClick={() => setManual(!manual)} aria-expanded={manual}>
            <span className="option__icon">
              <IconPen />
            </span>
            <span>
              <strong>Sign manually</strong>
              <small>Electron Cash or any wallet with “Sign message”</small>
            </span>
            <span className="option__meta">
              Copy · paste <IconChevron size={14} className="option__chev" />
            </span>
          </button>
          {manual && (
            <form onSubmit={useManual} className="option__form">
              <input
                className="c-input mono"
                placeholder="bitcoincash:q…"
                aria-label="BCH address you will sign with"
                value={input}
                onChange={(e) => (setInput(e.target.value), setError(undefined))}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              <button className="c-btn" type="submit" disabled={!input.trim()}>
                Use address
              </button>
            </form>
          )}
        </div>
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
            <small>A real mainnet key kept in this browser. Back it up before receiving funds.</small>
          </span>
          <span className="option__meta">Instant</span>
        </button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <WalletConnectDialog open={wcOpen} onClose={() => setWcOpen(false)} onConnected={onConnected} />
    </>
  );
};
