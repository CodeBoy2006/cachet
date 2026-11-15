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
    if (parsed.kind === 'invalid') {
      const reason = parsed.reason === 'empty' ? 'Paste an npub, a NIP-05 name or a BCH address' : parsed.reason;
      return setError(`${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`);
    }
    navigate(`/p/${encodeURIComponent(value.trim())}`);
  };
  return (
    <form className="search" onSubmit={submit} role="search" data-invalid={!!error || undefined}>
      <IconSearch />
      <input
        className="c-input"
        type="search"
        enterKeyHint="search"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? 'search-error' : undefined}
        value={value}
        onChange={(e) => (setValue(e.target.value), setError(undefined))}
        placeholder="npub, NIP-05 or address"
        aria-label="Look up an identity"
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
      />
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
