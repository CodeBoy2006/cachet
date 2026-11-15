import { useState } from 'react';
import { useLocation } from 'wouter';
import { parseIdentityInput } from '@cachet/discovery';
import { IconSearch } from '@cachet/react';

export const SearchBox = ({ autoFocus }: { autoFocus?: boolean }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [, navigate] = useLocation();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseIdentityInput(value);
    if (parsed.kind === 'invalid') return setError(parsed.reason === 'empty' ? 'Paste an npub, a NIP-05 name or a BCH address.' : parsed.reason);
    navigate(`/p/${encodeURIComponent(value.trim())}`);
  };
  return (
    <form className="search" onSubmit={submit} role="search">
      <IconSearch />
      <input
        className="c-input"
        value={value}
        onChange={(e) => (setValue(e.target.value), setError(undefined))}
        placeholder="npub, name@domain or BCH address"
        aria-label="Look up an identity"
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <button className="c-btn" type="submit">
        Look up
      </button>
      {error && <div className="search__error">{error}</div>}
    </form>
  );
};
