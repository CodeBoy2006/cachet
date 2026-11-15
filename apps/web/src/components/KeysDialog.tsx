import { useState } from 'react';
import { ConfirmButton, CopyChip, Dialog, IconDownload, Note } from '@cachet/react';
import { useSession } from '../lib/session.tsx';
import { KEYS, store } from '../lib/storage.ts';
import { downloadText } from '../lib/download.ts';

/** Sandbox keys live only in this browser. Make export obvious before anyone sends real BCH to them. */
export const KeysDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { forgetSandbox, persisted } = useSession();
  const [reveal, setReveal] = useState(false);
  const nsec = store.get(KEYS.sandboxNostr);
  const wif = store.get(KEYS.sandboxBch);
  const close = () => {
    setReveal(false);
    onClose();
  };
  const backup = () =>
    downloadText(
      'cachet-sandbox-keys.txt',
      [
        'Cachet sandbox keys. Anyone with these controls the identity and its BCH.',
        '',
        ...(nsec ? [`Nostr secret key (nsec): ${nsec}`] : []),
        ...(wif ? [`BCH private key (WIF): ${wif}`] : []),
        '',
      ].join('\n'),
    );

  return (
    <Dialog open={open} onClose={close} title="Sandbox keys">
      <div style={{ display: 'grid', gap: 16 }}>
        <Note tone={persisted ? 'warn' : 'danger'}>
          {persisted
            ? 'These keys exist only in this browser. Anyone with them controls the identity and any BCH sent to its address.'
            : 'Browser storage is blocked in this tab, so these keys live in memory and are lost on reload. Copy them before sending BCH.'}
        </Note>
        {!nsec && !wif ? (
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            No sandbox keys in this browser.
          </p>
        ) : !reveal ? (
          <div className="row">
            <button type="button" className="c-btn c-btn--secondary" onClick={() => setReveal(true)}>
              Show keys
            </button>
            <button type="button" className="c-btn c-btn--ghost" onClick={backup}>
              <IconDownload size={15} /> Save as file
            </button>
          </div>
        ) : (
          <div className="keys">
            {nsec && (
              <div>
                <span className="c-label">Nostr secret key (nsec)</span>
                <CopyChip value={nsec} title="Copy nsec" />
              </div>
            )}
            {wif && (
              <div>
                <span className="c-label">BCH private key (WIF)</span>
                <CopyChip value={wif} title="Copy WIF" />
                <span className="muted keys__hint">Import into Electron Cash or Cashonize to sweep funds.</span>
              </div>
            )}
          </div>
        )}
        {(nsec || wif) && (
          <ConfirmButton
            prompt="Forget both keys? This cannot be undone."
            confirmLabel="Forget keys"
            onConfirm={() => {
              forgetSandbox();
              close();
            }}
          >
            Forget sandbox keys
          </ConfirmButton>
        )}
      </div>
    </Dialog>
  );
};
