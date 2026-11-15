export interface Brand {
  id: 'a' | 'b';
  name: string;
  tagline: string;
  accent: string;
  accentDark: string;
  uiPort: number;
  apiPort: number;
}

export const BRANDS: Record<'a' | 'b', Brand> = {
  a: {
    id: 'a',
    name: 'Fieldnote',
    tagline: 'Notes for members',
    accent: '#9a3412',
    accentDark: '#f08a5d',
    uiPort: 5174,
    apiPort: 8701,
  },
  b: {
    id: 'b',
    name: 'Stall',
    tagline: 'Sell to anyone with a Nostr key',
    accent: '#1d4ed8',
    accentDark: '#7aa2ff',
    uiPort: 5175,
    apiPort: 8702,
  },
};

export const brandOf = (id: string | undefined): Brand => BRANDS[id === 'b' ? 'b' : 'a'];
