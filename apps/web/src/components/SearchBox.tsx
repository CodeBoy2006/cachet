import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { parseIdentityInput } from '@cachet/discovery';
import { IconCheck, IconSearch } from '@cachet/react';

const KIND_LABELS = {
  pubkey: 'npub',
  address: 'BCH',
  nip05: 'NIP-05',
} as const;

export const SearchBox = ({ autoFocus }: { autoFocus?: boolean }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [, navigate] = useLocation();

  useEffect(() => () => clearTimeout(jumpTimer.current), []);

  // Press '/' anywhere outside form fields to jump straight to lookup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const parsed = useMemo(() => (value.trim() ? parseIdentityInput(value) : undefined), [value]);
  const validBadge =
    parsed && parsed.kind !== 'invalid'
      ? parsed.kind === 'pubkey' && /^[0-9a-f]{64}$/i.test(value.trim())
        ? 'hex'
        : KIND_LABELS[parsed.kind]
      : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    clearTimeout(jumpTimer.current);
    const check = parseIdentityInput(value);
    if (check.kind === 'invalid') {
      const reason = check.reason === 'empty' ? 'Paste an npub, a NIP-05 name or a BCH address' : check.reason;
      setError(`${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`);
      setShake((s) => s + 1);
      return;
    }
    navigate(`/p/${encodeURIComponent(value.trim())}`);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (value.trim()) return;
    const text = e.clipboardData.getData('text').trim();
    if (!text) return;
    const check = parseIdentityInput(text);
    // Checksum-verified npubs and CashAddrs are unambiguous: confirm visually, then open right away.
    if (check.kind === 'pubkey' || check.kind === 'address') {
      clearTimeout(jumpTimer.current);
      jumpTimer.current = setTimeout(() => navigate(`/p/${encodeURIComponent(text)}`), 170);
    }
  };

  return (
    <form
      key={shake}
      className="search"
      onSubmit={submit}
      role="search"
      data-invalid={!!error || undefined}
      data-has-badge={!!validBadge || undefined}
    >
      <IconSearch />
      <input
        ref={inputRef}
        className="c-input"
        type="search"
        enterKeyHint="search"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? 'search-error' : undefined}
        value={value}
        onChange={(e) => {
          clearTimeout(jumpTimer.current);
          setValue(e.target.value);
          setError(undefined);
        }}
        onPaste={onPaste}
        placeholder="npub, NIP-05 or BCH address"
        aria-label="Look up an identity"
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {!value && (
        <kbd className="c-kbd search__kbd hide-sm" aria-hidden>
          /
        </kbd>
      )}
      {validBadge && (
        <span className="search__badge mono" aria-hidden>
          <IconCheck size={11} strokeWidth={2.4} /> {validBadge}
        </span>
      )}
      <button className="c-btn" type="submit">
        Look up
      </button>
      {error && (
        <div className="search__error" id="search-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
};
