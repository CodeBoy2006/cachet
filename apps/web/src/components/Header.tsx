import { useEffect, useRef, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { npubEncode } from '@cachet/core';
import { Avatar, IconDownload, IconKey, IconMoon, IconSun, IconX, Wordmark, shortNpub } from '@cachet/react';
import { useSession } from '../lib/session.tsx';
import { KeysDialog } from './KeysDialog.tsx';

const NavLink = ({ href, children, className }: { href: string; children: string; className?: string }) => {
  const [active] = useRoute(href === '/' ? '/' : `${href}/*?`);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
      {children}
    </Link>
  );
};

const ThemeToggle = () => {
  const [dark, setDark] = useState(() =>
    document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const flip = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cachet.theme', next);
    } catch {
      /* ignore */
    }
    setDark(!dark);
  };
  return (
    <button type="button" className="c-icon-btn" onClick={flip} aria-label="Toggle theme" style={{ width: 34, height: 34 }}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
};

const MeMenu = () => {
  const { nostr, hasSandboxKeys, disconnectNostr } = useSession();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!nostr && !hasSandboxKeys) return null;

  if (!nostr) {
    return (
      <>
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setKeys(true)} title="Back up sandbox keys">
          <IconKey size={14} /> Sandbox keys
        </button>
        <KeysDialog open={keys} onClose={() => setKeys(false)} />
      </>
    );
  }

  const npub = npubEncode(nostr.pubkey);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="me-chip" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Avatar pubkey={nostr.pubkey} size={26} />
        <span className="mono">{shortNpub(nostr.pubkey)}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__head">
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{nostr.signer.label}</div>
            <div className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all', marginTop: 2 }}>
              {npub}
            </div>
          </div>
          <Link href={`/p/${npub}`} onClick={() => setOpen(false)}>
            <IconKey /> Your public profile
          </Link>
          {hasSandboxKeys && (
            <button type="button" className="menu__item" onClick={() => (setKeys(true), setOpen(false))}>
              <IconDownload /> Back up sandbox keys
            </button>
          )}
          <button type="button" className="menu__item" onClick={() => (disconnectNostr(), setOpen(false))}>
            <IconX /> Disconnect
          </button>
        </div>
      )}
      <KeysDialog open={keys} onClose={() => setKeys(false)} />
    </div>
  );
};

export const Header = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className="header" data-scrolled={scrolled}>
      <div className="wrap">
        <Link href="/" className="header__brand" aria-label="Cachet home">
          <Wordmark />
        </Link>
        <nav className="nav">
          <NavLink href="/new">Create</NavLink>
          <NavLink href="/lab">Lab</NavLink>
          <a className="hide-sm" href="https://github.com/nostr-protocol/nips/blob/master/39.md" target="_blank" rel="noreferrer">
            NIP-39
          </a>
        </nav>
        <div className="header__end">
          <ThemeToggle />
          <MeMenu />
        </div>
      </div>
    </header>
  );
};
