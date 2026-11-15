import { useState } from 'react';
import { recoverSigner, parseCashAddr, isAddressError } from '@cachet/core';
import { CopyIcon, Note } from '@cachet/react';

/** For wallets without WalletConnect: copy the exact message, sign it elsewhere, paste the result. */
export const ManualSign = ({ message, address, onSigned }: { message: string; address: string; onSigned: (sig: string) => void }) => {
  const [sig, setSig] = useState('');
  const [error, setError] = useState<string>();

  const check = (value: string) => {
    setSig(value);
    setError(undefined);
    const trimmed = value.trim();
    if (!trimmed) return;
    const parsed = parseCashAddr(address);
    const r = recoverSigner(message, trimmed);
    if (!r.ok) return setError(r.code === 'bch_signature_malformed' ? `Not a message signature: ${r.detail}.` : 'This signature is for a different message. Copy the message again, exactly.');
    if (isAddressError(parsed) || r.publicKeyHash.some((b, i) => b !== parsed.payload[i])) {
      return setError('Signed by a different address. Sign with the address shown above.');
    }
    onSigned(trimmed);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <span className="c-label">1. Sign this exact message with {address.split(':')[1]?.slice(0, 10)}…</span>
        <div className="message-box">
          <pre className="c-code">{message}</pre>
          <CopyIcon value={message} title="Copy message" />
        </div>
      </div>
      <div>
        <label className="c-label" htmlFor="sig">
          2. Paste the signature
        </label>
        <textarea
          id="sig"
          className="c-input mono"
          rows={2}
          placeholder="H… or I… (Base64, 88 characters)"
          value={sig}
          onChange={(e) => check(e.target.value)}
          spellCheck={false}
        />
      </div>
      {error && <Note tone="danger">{error}</Note>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        In Electron Cash: Tools → Sign/verify message. Keep the line breaks; the signature covers every byte.
      </p>
    </div>
  );
};
