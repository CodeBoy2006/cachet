import { describe, expect, it } from 'vitest';
import { brandOf, walletErrorText } from './wallets.ts';

describe('walletErrorText', () => {
  it('reads WalletConnect records, Errors and strings the same way', () => {
    expect(walletErrorText({ code: 5000, message: 'User rejected.' })).toBe('Declined in the wallet.');
    expect(walletErrorText(new Error('Request denied by user'))).toBe('Declined in the wallet.');
    expect(walletErrorText('cancelled')).toBe('Declined in the wallet.');
    expect(walletErrorText({ code: 1, message: 'cannot reach Fulcrum' })).toBe('Cannot reach Fulcrum.');
    expect(walletErrorText(new Error('Wallet returned an invalid signed transaction.'))).toBe('Wallet returned an invalid signed transaction.');
  });

  it('never shows "[object Object]" or an empty message', () => {
    expect(walletErrorText({ code: 7 })).toBe('The wallet did not respond.');
    expect(walletErrorText(undefined)).toBe('The wallet did not respond.');
    expect(walletErrorText(new Error('  '))).toBe('The wallet did not respond.');
  });
});

describe('brandOf', () => {
  it('matches the names wallets report, case-insensitively', () => {
    expect(brandOf('Paytaca')).toBe('paytaca');
    expect(brandOf('Paytaca Wallet')).toBe('paytaca');
    expect(brandOf('selene')).toBe('selene');
    expect(brandOf('Cashonize')).toBeUndefined();
    expect(brandOf(null)).toBeUndefined();
  });
});
