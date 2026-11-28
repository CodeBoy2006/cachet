import { Link } from 'wouter';
import { Logo } from '@cachet/react';
import { config } from '../config.ts';

export const Footer = () => (
  <footer className="footer">
    <div className="wrap">
      <span className="row" style={{ gap: 8 }}>
        <Logo size={16} /> <span className="mono">bch-nostr-bind/v1</span>
      </span>
      <Link href="/lab">Lab</Link>
      {config.repoUrl && (
        <a href={config.repoUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      )}
      <a href="https://github.com/mainnet-pat/wc2-bch-bcr" target="_blank" rel="noreferrer">
        BCH WalletConnect
      </a>
      <span className="footer__end">No server in the trust path. MIT.</span>
    </div>
  </footer>
);
