/**
 * BCH WalletConnect v2 (wc2-bch-bcr): bch_getAddresses + bch_signMessage.
 * Tested against the spec and Cashonize's implementation; real-wallet results
 * are recorded in docs/COMPATIBILITY.md, separately from automated tests.
 */
import type SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { normalizeCashAddrInput, isAddressError, type Network } from '@cachet/core';
import { assertSignedBy, type BchSigner } from './bch.ts';

const CHAIN: Record<Network, string> = { mainnet: 'bch:bitcoincash', chipnet: 'bch:bchtest' };
const METHODS = ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage'];

export interface WalletConnectOptions {
  projectId: string;
  network?: Network;
  metadata?: { name: string; description: string; url: string; icons: string[] };
}

type Listener = (addresses: string[]) => void;

export class WalletConnectBchSigner implements BchSigner {
  readonly type = 'walletconnect' as const;
  readonly network: Network;
  private session?: SessionTypes.Struct;
  private listeners = new Set<Listener>();
  private disconnectListeners = new Set<() => void>();
  /** Bumped whenever addresses change or the session ends; stale in-flight flows check it. */
  epoch = 0;

  private constructor(
    private readonly client: SignClient,
    network: Network,
  ) {
    this.network = network;
    client.on('session_event', ({ topic, params }) => {
      if (topic !== this.session?.topic || params.event.name !== 'addressesChanged') return;
      this.epoch++;
      const data = params.event.data;
      const list = Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : [];
      this.listeners.forEach((l) => l(list));
    });
    const ended = ({ topic }: { topic: string }) => {
      if (topic !== this.session?.topic) return;
      this.session = undefined;
      this.epoch++;
      this.disconnectListeners.forEach((l) => l());
    };
    client.on('session_delete', ended);
    client.on('session_expire', ended);
  }

  static async init(opts: WalletConnectOptions) {
    const { default: Client } = await import('@walletconnect/sign-client');
    const client = await Client.init({
      projectId: opts.projectId,
      metadata: opts.metadata ?? {
        name: 'Cachet',
        description: 'Link a BCH address to a Nostr key',
        url: globalThis.location?.origin ?? 'https://cachet.example',
        icons: [],
      },
    });
    const signer = new WalletConnectBchSigner(client, opts.network ?? 'mainnet');
    const chain = CHAIN[signer.network];
    signer.session = client.session.getAll().find((s) => s.namespaces.bch?.accounts.some((a) => a.startsWith(`${chain}:`)));
    return signer;
  }

  get label() {
    return this.session?.peer.metadata.name ?? 'WalletConnect';
  }

  get connected() {
    return !!this.session;
  }

  get peerIcon() {
    return this.session?.peer.metadata.icons?.[0];
  }

  /** Starts pairing. Show `uri` as a QR code; `approved` resolves when the wallet accepts. */
  async connect(): Promise<{ uri: string; approved: Promise<void> }> {
    const { uri, approval } = await this.client.connect({
      requiredNamespaces: { bch: { chains: [CHAIN[this.network]], methods: METHODS, events: ['addressesChanged'] } },
    });
    if (!uri) throw new Error('WalletConnect did not return a pairing URI');
    return {
      uri,
      approved: approval().then((session) => {
        this.session = session;
        this.epoch++;
      }),
    };
  }

  onAddressesChanged(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onDisconnect(l: () => void) {
    this.disconnectListeners.add(l);
    return () => this.disconnectListeners.delete(l);
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    if (!this.session) throw new Error('Wallet is not connected');
    return this.client.request<T>({
      topic: this.session.topic,
      chainId: CHAIN[this.network],
      request: { method, params },
    });
  }

  async getAddresses(): Promise<string[]> {
    const fromSession = this.session?.namespaces.bch?.accounts
      .map((a) => a.split(':').slice(2).join(':'))
      .map((a) => (a.includes(':') ? a : `${CHAIN[this.network].split(':')[1]}:${a}`));
    let addresses: unknown;
    try {
      addresses = await this.request<unknown>('bch_getAddresses', {});
    } catch {
      addresses = fromSession;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    return [
      ...new Set(
        list.flatMap((a) => {
          if (typeof a !== 'string') return [];
          const parsed = normalizeCashAddrInput(a, this.network);
          return isAddressError(parsed) ? [] : [parsed.address];
        }),
      ),
    ];
  }

  async signMessage(message: string, address: string): Promise<string> {
    const epoch = this.epoch;
    const signature = await this.request<unknown>('bch_signMessage', {
      message,
      userPrompt: 'Link this BCH address to your Nostr key',
    });
    if (epoch !== this.epoch) throw new Error('Wallet addresses changed while signing. Please sign again.');
    return assertSignedBy(message, signature, address);
  }

  async disconnect() {
    if (!this.session) return;
    const topic = this.session.topic;
    this.session = undefined;
    this.epoch++;
    await this.client.disconnect({ topic, reason: { code: 6000, message: 'User disconnected' } }).catch(() => {});
  }
}
