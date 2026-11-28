import { DEFAULT_RELAYS, INDEXER_RELAYS, uniqueRelays } from '@cachet/discovery';
import { DEFAULT_ELECTRUM } from '@cachet/pay';

const env = import.meta.env;
const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
const local = env.DEV || /^(localhost|[\w.-]+\.localhost|127\.0\.0\.1|\[::1\])$/.test(globalThis.location?.hostname ?? '');

/** Live mainnet identity resolved on the public home page when VITE_FEATURED_NPUB is unset. */
export const DEFAULT_FEATURED_NPUB = 'npub1jphw36087g88e3spq8ycuumn2z3amruppx8zjakcgr6gkmsevghqzlxs5x';

export const config = {
  featured: clean(env.VITE_FEATURED_NPUB) ?? (!local && !clean(env.VITE_RELAYS) ? DEFAULT_FEATURED_NPUB : undefined),
  wcProjectId: clean(env.VITE_WC_PROJECT_ID),
  relays: clean(env.VITE_RELAYS) ? uniqueRelays(env.VITE_RELAYS!.split(',')) : DEFAULT_RELAYS,
  /** Only used to find NIP-65 lists; skipped when a custom relay list (e.g. a local relay) is set. */
  indexers: clean(env.VITE_RELAYS) ? [] : INDEXER_RELAYS,
  electrum: DEFAULT_ELECTRUM,
  apps: [
    { id: 'a', name: 'Fieldnote', url: clean(env.VITE_RP_A_URL) ?? (local ? 'http://localhost:5174' : undefined), blurb: 'Members-only notes' },
    { id: 'b', name: 'Stall', url: clean(env.VITE_RP_B_URL) ?? (local ? 'http://localhost:5175' : undefined), blurb: 'Seller dashboard' },
  ].flatMap(({ url, ...app }) => (url ? [{ ...app, url }] : [])),
  repoUrl: clean(env.VITE_REPO_URL),
  explorerTx: (txid: string) => `https://blockchair.com/bitcoin-cash/transaction/${txid}`,
};
