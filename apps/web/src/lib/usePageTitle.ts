import { useEffect } from 'react';

const BASE = 'Cachet';

/** Sets the tab title for the current page; `undefined` keeps the default while data loads. */
export const usePageTitle = (title: string | undefined) => {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · ${BASE}`;
    return () => {
      document.title = prev;
    };
  }, [title]);
};
