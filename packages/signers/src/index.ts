export * from './nostr.ts';
export * from './bch.ts';
export type { WalletConnectOptions } from './walletconnect.ts';

/** Loaded on demand: the WalletConnect SDK is large and only needed when the user picks it. */
export const loadWalletConnect = () => import('./walletconnect.ts').then((m) => m.WalletConnectBchSigner);
