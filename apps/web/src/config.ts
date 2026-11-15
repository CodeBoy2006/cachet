import { DEFAULT_RELAYS, INDEXER_RELAYS, uniqueRelays } from '@cachet/discovery';
import { DEFAULT_ELECTRUM } from '@cachet/pay';

const env = import.meta.env;
const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

export const config = {
  featured: clean(env.VITE_FEATURED_NPUB),
  wcProjectId: clean(env.VITE_WC_PROJECT_ID),
  relays: clean(env.VITE_RELAYS) ? uniqueRelays(env.VITE_RELAYS!.split(',')) : DEFAULT_RELAYS,
  /** Only used to find NIP-65 lists; skipped when a custom relay list (e.g. a local relay) is set. */
  indexers: clean(env.VITE_RELAYS) ? [] : INDEXER_RELAYS,
  electrum: DEFAULT_ELECTRUM,
  apps: [
    { id: 'a', name: 'Fieldnote', url: clean(env.VITE_RP_A_URL) ?? 'http://localhost:5174', blurb: 'Members-only notes' },
    { id: 'b', name: 'Stall', url: clean(env.VITE_RP_B_URL) ?? 'http://localhost:5175', blurb: 'Seller dashboard' },
  ],
  banner: {
    slides: clean(env.VITE_SLIDES_URL),
    repo: clean(env.VITE_REPO_URL),
    ember: clean(env.VITE_EMBER_ADDRESS) ?? 'bitcoincash:zzq4hd7sk4x32sxnusd7ch82d5c35fnwcg3ytwteug',
  },
  explorerTx: (txid: string) => `https://blockchair.com/bitcoin-cash/transaction/${txid}`,
};
