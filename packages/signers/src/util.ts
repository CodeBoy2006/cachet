export {
  addressFromPublicKey,
  isAddressError,
  parseCashAddr,
  recoverSigner,
  signMessage,
  type Network,
} from '@cachet/core';

export const equalBytesSafe = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
