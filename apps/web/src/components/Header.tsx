import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { npubEncode } from '@cachet/core';
import { Avatar, IconDownload, IconKey, IconMoon, IconSun, IconX, Wordmark, shortNpub, useCopy } from '@cachet/react';
import { useSession } from '../lib/session.tsx';
import { applyTheme, currentTheme, onSystemThemeChange, saveTheme } from '../lib/theme.ts';
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
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => onSystemThemeChange(() => setTheme(currentTheme())), []);
  const next = theme === 'dark' ? 'light' : 'dark';
  const flip = () => {
    saveTheme(next);
    applyTheme(next);
    setTheme(next);
  };
  return (
    <button type="button" className="c-icon-btn theme-toggle" onClick={flip} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <span className="theme-toggle__icon" key={theme}>
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </span>
    </button>
  );
};

const MeMenu = () => {
  const { nostr, hasSandboxKeys, disconnectNostr } = useSession();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState(false);
  const [location] = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { copied, copy } = useCopy();

  useEffect(() => setOpen(false), [location]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!nostr && !hasSandboxKeys) return null;

  if (!nostr) {
    return (
      <>
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setKeys(true)} title="Back up sandbox keys">
          <IconKey size={14} /> <span className="hide-sm">Sandbox keys</span>
        </button>
        <KeysDialog open={keys} onClose={() => setKeys(false)} />
      </>
    );
  }

  const npub = npubEncode(nostr.pubkey);
  return (
    <div ref={ref} className="me">
      <button ref={button} type="button" className="me-chip" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Your identity">
        <Avatar pubkey={nostr.pubkey} size={26} />
        <span className="mono">{shortNpub(nostr.pubkey)}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__head">
            <div className="menu__label">{nostr.signer.label}</div>
            <button type="button" className="menu__npub mono" onClick={() => copy(npub)} title="Copy npub">
              {npub}
              <span className="menu__copied" data-on={copied}>
                Copied
              </span>
            </button>
          </div>
          <Link href={`/p/${npub}`} role="menuitem">
            <IconKey /> Your public profile
          </Link>
          {hasSandboxKeys && (
            <button type="button" role="menuitem" className="menu__item" onClick={() => (setKeys(true), setOpen(false))}>
              <IconDownload /> Back up sandbox keys
            </button>
          )}
          <button type="button" role="menuitem" className="menu__item" onClick={() => (disconnectNostr(), setOpen(false))}>
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
        <nav className="nav" aria-label="Main">
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
