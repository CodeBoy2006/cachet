/** Wallets with a logo in /public/wallets. Anything else is drawn with a neutral glyph. */
export type WalletBrand = 'paytaca' | 'selene';

export const WALLET_LOGOS: Record<WalletBrand, string> = {
  paytaca: `${import.meta.env.BASE_URL}wallets/paytaca.png`,
  selene: `${import.meta.env.BASE_URL}wallets/selene.svg`,
};

/** Picks a known logo from the name a wallet reports about itself. */
export const brandOf = (name?: string | null): WalletBrand | undefined =>
  name && /paytaca/i.test(name) ? 'paytaca' : name && /selene/i.test(name) ? 'selene' : undefined;

/**
 * Wallet errors arrive as Error objects, WalletConnect `{ code, message }` records
 * or bare strings. Rejections read the same whichever wallet sent them; everything
 * else becomes one short sentence.
 */
export const walletErrorText = (e: unknown): string => {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === 'object' && e !== null && 'message' in e
        ? String((e as { message: unknown }).message)
        : typeof e === 'string'
          ? e
          : '';
  if (/reject|declin|denied|cancel/i.test(raw)) return 'Declined in the wallet.';
  const text = raw.trim() || 'The wallet did not respond';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?…]$/.test(text) ? '' : '.'}`;
};
