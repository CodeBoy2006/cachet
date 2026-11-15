import { useState } from 'react';
import { CopyChip, Dialog, Note } from '@cachet/react';
import { useSession } from '../lib/session.tsx';
import { KEYS, store } from '../lib/storage.ts';

/** Sandbox keys live only in this browser. Make export obvious before anyone sends real BCH to them. */
export const KeysDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { forgetSandbox, persisted } = useSession();
  const [reveal, setReveal] = useState(false);
  const nsec = store.get(KEYS.sandboxNostr);
  const wif = store.get(KEYS.sandboxBch);
  return (
    <Dialog open={open} onClose={() => (setReveal(false), onClose())} title="Sandbox keys">
      <div style={{ display: 'grid', gap: 16 }}>
        <Note tone={persisted ? 'warn' : 'danger'}>
          {persisted
            ? 'These keys exist only in this browser. Anyone with them controls the identity and any BCH sent to its address.'
            : 'Browser storage is blocked in this tab — these keys live in memory only and will be lost on reload. Copy them before sending BCH.'}
        </Note>
        {!reveal ? (
          <button type="button" className="c-btn c-btn--secondary" onClick={() => setReveal(true)}>
            Show keys
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {nsec && (
              <div>
                <span className="c-label">Nostr secret key (nsec)</span>
                <CopyChip value={nsec} />
              </div>
            )}
            {wif && (
              <div>
                <span className="c-label">BCH private key (WIF) — import into Electron Cash or Cashonize to sweep</span>
                <CopyChip value={wif} />
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="c-btn c-btn--danger"
          onClick={() => {
            if (confirm('Forget sandbox keys in this browser? This cannot be undone.')) {
              forgetSandbox();
              onClose();
            }
          }}
        >
          Forget sandbox keys
        </button>
      </div>
    </Dialog>
  );
};
