export type Theme = 'light' | 'dark';

const KEY = 'cachet.theme';
const BG: Record<Theme, string> = { light: '#f4f3ef', dark: '#0e0e0d' };
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export const savedTheme = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
};

export const saveTheme = (theme: Theme) => {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the choice still applies to this tab */
  }
};

export const currentTheme = (): Theme => {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return media().matches ? 'dark' : 'light';
};

/** Sets the page theme and keeps the browser chrome (theme-color) in step with it. */
export const applyTheme = (theme: Theme | null) => {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  const effective = theme ?? (media().matches ? 'dark' : 'light');
  // A manual choice overrides both media-specific tags.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (theme) m.content = BG[effective];
    else m.content = m.media.includes('dark') ? BG.dark : BG.light;
  });
};

/** Fires when the OS theme changes; only matters while the user has not picked one. */
export const onSystemThemeChange = (fn: () => void) => {
  const m = media();
  const handler = () => {
    if (!savedTheme()) fn();
  };
  m.addEventListener('change', handler);
  return () => m.removeEventListener('change', handler);
};
