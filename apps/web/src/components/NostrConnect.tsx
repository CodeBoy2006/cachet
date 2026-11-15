import { useEffect, useState } from 'react';
import { Nip07Signer } from '@cachet/signers';
import { IconKey, IconPuzzle, Note, Spinner } from '@cachet/react';
import { useSession } from '../lib/session.tsx';

export const NostrConnect = ({ onDone }: { onDone?: () => void }) => {
  const { connectExtension, useSandboxNostr, sandboxNostr } = useSession();
  const [hasExt, setHasExt] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const existingSandbox = sandboxNostr();

  useEffect(() => {
    void Nip07Signer.waitForExtension(1200).then(setHasExt);
  }, []);

  const ext = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await connectExtension();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The extension refused the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="options">
        <button type="button" className="option" onClick={ext} disabled={hasExt === false || busy}>
          <span className="option__icon">
            <IconPuzzle />
          </span>
          <span>
            <strong>Browser extension</strong>
            <small>Alby, nos2x, Keys.band or any NIP-07 signer</small>
          </span>
          <span className="option__meta" data-tone={hasExt ? 'good' : undefined}>
            {busy ? <Spinner /> : hasExt === undefined ? 'Checking…' : hasExt ? 'Detected' : 'Not installed'}
          </span>
        </button>
        <button
          type="button"
          className="option"
          onClick={() => {
            useSandboxNostr();
            onDone?.();
          }}
        >
          <span className="option__icon">
            <IconKey />
          </span>
          <span>
            <strong>{existingSandbox ? 'Sandbox key in this browser' : 'Create a sandbox key'}</strong>
            <small>Kept in this browser only. Good for trying it; back it up before relying on it.</small>
          </span>
          <span className="option__meta">{existingSandbox ? 'Saved' : 'Instant'}</span>
        </button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
    </>
  );
};
