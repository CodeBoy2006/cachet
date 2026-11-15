import { Link } from 'wouter';

export const NotFound = () => (
  <div className="wrap">
    <div className="empty">
      <h2>Page not found</h2>
      <p>Try looking up an npub or a BCH address instead.</p>
      <Link className="c-btn c-btn--secondary" href="/">
        Home
      </Link>
    </div>
  </div>
);
