import {
  decodePrivateKeyWif,
  encodePrivateKeyWif,
  generatePrivateKey,
  secp256k1,
} from '@bitauth/libauth';
import {
  addressFromPublicKey,
  equalBytesSafe,
  isAddressError,
  parseCashAddr,
  recoverSigner,
  signMessage,
  type Network,
} from './util.ts';

export interface SignedTransactionResult {
  signedTransaction: string;
  signedTransactionHash?: string;
}

export interface BchSigner {
  readonly type: 'walletconnect' | 'local';
  readonly label: string;
  readonly network: Network;
  getAddresses(): Promise<string[]>;
  /** Returns a Base64 compact signature, already checked against `address`. */
  signMessage(message: string, address: string): Promise<string>;
  signTransaction?(transaction: unknown): Promise<SignedTransactionResult>;
  /** Remote wallets: the account list changed in the wallet. Returns an unsubscribe function. */
  onAddressesChanged?(listener: (addresses: string[]) => void): () => void;
  /** Remote wallets: the wallet ended or expired the session. Returns an unsubscribe function. */
  onDisconnect?(listener: () => void): () => void;
  disconnect?(): Promise<void>;
}

/**
 * Wallet output is checked before anyone else sees it: the signature must
 * recover to the address we asked about, not merely "some" address.
 */
export const assertSignedBy = (message: string, signature: unknown, address: string): string => {
  const parsed = parseCashAddr(address);
  if (isAddressError(parsed)) throw new Error(`Invalid address: ${parsed.detail}`);
  if (typeof signature !== 'string') throw new Error('Wallet returned no signature');
  const recovered = recoverSigner(message, signature.trim());
  if (!recovered.ok) throw new Error(`Wallet returned an unusable signature (${recovered.detail})`);
  if (!equalBytesSafe(recovered.publicKeyHash, parsed.payload)) {
    throw new Error('The wallet signed with a different address than the one selected');
  }
  return signature.trim();
};

/** Browser-held key for trying the flow without a wallet. Funds sent to it are only as safe as this browser. */
export class LocalBchSigner implements BchSigner {
  readonly type = 'local' as const;
  readonly label = 'Sandbox key';
  readonly publicKey: Uint8Array;

  constructor(
    private readonly privateKey: Uint8Array,
    readonly network: Network = 'mainnet',
    readonly compressed: boolean = true,
  ) {
    const pub = compressed ? secp256k1.derivePublicKeyCompressed(privateKey) : secp256k1.derivePublicKeyUncompressed(privateKey);
    if (typeof pub === 'string') throw new Error(pub);
    this.publicKey = pub;
  }

  static generate(network: Network = 'mainnet') {
    return new LocalBchSigner(generatePrivateKey(), network);
  }

  static fromWif(wif: string) {
    const d = decodePrivateKeyWif(wif.trim());
    if (typeof d === 'string') throw new Error(d);
    return new LocalBchSigner(d.privateKey, d.type.startsWith('mainnet') ? 'mainnet' : 'chipnet', !d.type.toLowerCase().includes('uncompressed'));
  }

  get wif() {
    const type = this.network === 'mainnet'
      ? this.compressed ? 'mainnet' : 'mainnetUncompressed'
      : this.compressed ? 'testnet' : 'testnetUncompressed';
    return encodePrivateKeyWif(this.privateKey, type);
  }

  address(tokenAware = false) {
    return addressFromPublicKey(this.publicKey, this.network, tokenAware);
  }

  async getAddresses() {
    return [this.address(false), this.address(true)];
  }

  async signMessage(message: string, address: string) {
    return assertSignedBy(message, signMessage(this.privateKey, message, this.compressed), address);
  }

  /** Signs without checking which address the caller expects. For tests and the lab's attack cases. */
  signRaw(message: string) {
    return signMessage(this.privateKey, message, this.compressed);
  }
}
