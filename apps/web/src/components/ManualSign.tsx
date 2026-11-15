import { useRef, useState } from 'react';
import { recoverSigner, parseCashAddr, isAddressError } from '@cachet/core';
import { CopyChip, CopyIcon, IconPaste, Note, shortCashaddr } from '@cachet/react';

/** For wallets without WalletConnect: copy the exact message, sign it elsewhere, paste the result. */
export const ManualSign = ({ message, address, onSigned }: { message: string; address: string; onSigned: (sig: string) => void }) => {
  const [sig, setSig] = useState('');
  const [error, setError] = useState<string>();
  const sigRef = useRef<HTMLTextAreaElement>(null);

  const check = (value: string) => {
    setSig(value);
    setError(undefined);
    const trimmed = value.trim();
    if (!trimmed) return;
    const parsed = parseCashAddr(address);
    const r = recoverSigner(message, trimmed);
    if (!r.ok) {
      return setError(
        r.code === 'bch_signature_malformed'
          ? `Not a message signature: ${r.detail}.`
          : 'This signature is for a different message. Copy the message again, exactly.',
      );
    }
    if (isAddressError(parsed) || r.publicKeyHash.some((b, i) => b !== parsed.payload[i])) {
      return setError('Signed by a different address. Sign with the address shown above.');
    }
    onSigned(trimmed);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        check(text);
        return;
      }
    } catch {
      /* Browser may require manual paste; focus the field below. */
    }
    sigRef.current?.focus();
  };

  return (
    <div className="manual">
      <div>
        <div className="manual__head">
          <span className="c-label">
            1. Sign this exact message with <span className="mono">{shortCashaddr(address)}</span>
          </span>
          <CopyChip value={message} label="Copy message" />
        </div>
        <div className="message-box">
          <pre className="c-code">{message}</pre>
          <CopyIcon value={message} title="Copy message" />
        </div>
      </div>
      <div>
        <div className="manual__head">
          <label className="c-label" htmlFor="sig">
            2. Paste the signature
          </label>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={pasteFromClipboard}>
            <IconPaste size={13} /> Paste & verify
          </button>
        </div>
        <textarea
          ref={sigRef}
          id="sig"
          className="c-input mono"
          rows={2}
          placeholder="H… or I… (Base64, 88 characters)"
          value={sig}
          aria-invalid={!!error || undefined}
          onChange={(e) => check(e.target.value)}
          spellCheck={false}
        />
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <p className="muted manual__hint">In Electron Cash: Tools → Sign/verify message. Keep the line breaks; the signature covers every byte.</p>
    </div>
  );
};
