import { Link } from 'wouter';
import { SearchBox } from '../components/SearchBox.tsx';
import { usePageTitle } from '../lib/usePageTitle.ts';

export const NotFound = () => {
  usePageTitle('Not found');
  return (
    <div className="wrap page">
      <div className="empty">
        <h2>Page not found</h2>
        <p>Look up an npub or a BCH address instead.</p>
        <div className="empty__search">
          <SearchBox />
        </div>
        <Link className="c-btn c-btn--ghost" href="/">
          Home
        </Link>
      </div>
    </div>
  );
};
