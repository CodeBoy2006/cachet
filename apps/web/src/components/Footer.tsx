import { Link } from 'wouter';
import { Logo } from '@cachet/react';
import { config } from '../config.ts';

export const Footer = () => (
  <footer className="footer">
    <div className="wrap">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Logo size={16} /> bch-nostr-bind/v1
      </span>
      <Link href="/lab">Lab</Link>
      {config.banner.repo && (
        <a href={config.banner.repo} target="_blank" rel="noreferrer">
          Source
        </a>
      )}
      <a href="https://github.com/mainnet-pat/wc2-bch-bcr" target="_blank" rel="noreferrer">
        BCH WalletConnect
      </a>
      <span style={{ marginLeft: 'auto' }}>No server in the trust path. MIT.</span>
    </div>
  </footer>
);
