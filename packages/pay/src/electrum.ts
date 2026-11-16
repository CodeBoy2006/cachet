/**
 * Minimal Electrum Cash protocol client over WebSocket (Fulcrum servers).
 * Used to watch an address for an incoming payment and to load UTXOs.
 */
import { binToHex, cashAddressToLockingBytecode, sha256 } from '@bitauth/libauth';
import { addressFromPublicKey } from '@cachet/core';
import { parseBch } from './bip21.ts';
import type { SpendableUtxo } from './tx.ts';

export const DEFAULT_ELECTRUM = [
  'wss://bch.imaginary.cash:50004',
  'wss://electroncash.dk:50004',
  'wss://bch.loping.net:50004',
  'wss://fulcrum.greyh.at:50004',
];

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Notify = (params: unknown[]) => void;

export const lockingBytecodeOf = (cashaddr: string): Uint8Array => {
  const r = cashAddressToLockingBytecode(cashaddr);
  if (typeof r === 'string') throw new Error(r);
  return r.bytecode;
};

/** Electrum script hash: SHA-256 of the locking bytecode, byte-reversed, hex. */
export const scripthashOf = (cashaddr: string) => binToHex(sha256.hash(lockingBytecodeOf(cashaddr)).reverse());

export class ElectrumClient {
  private ws?: WebSocket;
  private connecting?: Promise<void>;
  private inflight = new Set<WebSocket>();
  private epoch = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subscribers = new Map<string, Set<Notify>>();
  server?: string;

  constructor(private readonly servers: string[] = DEFAULT_ELECTRUM) {}

  connect(): Promise<void> {
    if (this.ws?.readyState === 1) return Promise.resolve();
    if (!this.connecting) {
      const attempt: Promise<void> = this.connectServers().finally(() => {
        if (this.connecting === attempt) this.connecting = undefined;
      });
      this.connecting = attempt;
    }
    return this.connecting;
  }

  private async connectServers(): Promise<void> {
    const epoch = this.epoch;
    // Race the servers; keep the first that completes a version handshake.
    const attempts = this.servers.map(
      (url) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(url);
          this.inflight.add(ws);
          const fail = (error: Error) => {
            clearTimeout(timer);
            this.inflight.delete(ws);
            reject(error);
            ws.close();
          };
          const timer = setTimeout(() => fail(new Error('timeout')), 9000);
          ws.onerror = () => fail(new Error(`cannot reach ${url}`));
          ws.onclose = () => {
            clearTimeout(timer);
            this.inflight.delete(ws);
            reject(new Error('Electrum connection closed'));
          };
          ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'server.version', params: ['cachet', '1.4'] }));
          ws.onmessage = (m) => {
            try {
              const msg = JSON.parse(String(m.data));
              if (msg?.id !== 0 || msg.error || !Array.isArray(msg.result)) throw new Error('Invalid Electrum version response');
              clearTimeout(timer);
              this.inflight.delete(ws);
              resolve(ws);
            } catch {
              fail(new Error('Invalid Electrum version response'));
            }
          };
        }),
    );
    const winner = await Promise.any(attempts).catch(() => {
      throw new Error(this.epoch !== epoch ? 'Electrum connection closed' : 'No Electrum server reachable');
    });
    attempts.forEach((p) => p.then((ws) => ws !== winner && ws.close()).catch(() => {}));
    if (this.epoch !== epoch) {
      winner.close();
      throw new Error('Electrum connection closed');
    }
    this.ws = winner;
    this.server = winner.url;
    winner.onmessage = (m) => this.onMessage(String(m.data));
    winner.onclose = () => {
      if (this.ws !== winner) return;
      this.pending.forEach((p) => {
        clearTimeout(p.timer);
        p.reject(new Error('Electrum connection closed'));
      });
      this.pending.clear();
      this.ws = undefined;
    };
  }

  private onMessage(raw: string) {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown[] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'Electrum error'));
      else p.resolve(msg.result);
    } else if (msg.method && Array.isArray(msg.params)) {
      this.subscribers.get(`${msg.method}:${String(msg.params[0])}`)?.forEach((cb) => cb(msg.params!));
    }
  }

  async request<T>(method: string, ...params: unknown[]): Promise<T> {
    await this.connect();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async subscribeScripthash(scripthash: string, cb: Notify) {
    const key = `blockchain.scripthash.subscribe:${scripthash}`;
    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key)!.add(cb);
    await this.request('blockchain.scripthash.subscribe', scripthash);
    return () => this.subscribers.get(key)?.delete(cb);
  }

  /** Drops the connection. The client stays usable: the next request connects again. */
  close() {
    this.epoch++;
    // The handshake in flight will reject; a connect() after close() must not wait on it.
    this.connecting = undefined;
    const ws = this.ws;
    this.ws = undefined;
    for (const s of this.inflight) s.close();
    this.inflight.clear();
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error('Electrum connection closed'));
    });
    this.pending.clear();
    ws?.close();
  }
}

/** Accepts a wallet's successful broadcast only if Fulcrum accepts or can retrieve the exact txid. */
export const ensureBroadcast = async (client: ElectrumClient, rawHex: string, txid: string): Promise<void> => {
  try {
    await client.request<string>('blockchain.transaction.broadcast', rawHex);
  } catch (error) {
    try {
      await client.request('blockchain.transaction.get', txid);
    } catch {
      throw error;
    }
  }
};

export interface Utxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
  token_data?: unknown;
}

export interface IncomingPayment {
  txid: string;
  sats: bigint;
  confirmed: boolean;
}

interface VerboseTx {
  txid: string;
  vout: { value: number | string; scriptPubKey?: { hex?: string; addresses?: string[] } }[];
}

const satsFromBch = (v: number | string): bigint => {
  if (typeof v === 'string') {
    const direct = parseBch(v);
    if (direct !== null) return direct;
  }
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? (parseBch(n.toFixed(8)) ?? 0n) : 0n;
};

export interface HdScanOptions {
  gapLimit?: number;
  maxAddresses?: number;
}

export interface HdScanResult {
  utxos: SpendableUtxo[];
  changeAddress: string;
  balance: bigint;
}

/**
 * BIP44 gap-limit discovery over Fulcrum: scans receive (0) and change (1) chains
 * until `gapLimit` consecutive unused addresses are seen, then loads spendable
 * non-token UTXOs and selects the first unused change address.
 */
export const scanHdWallet = async (
  client: ElectrumClient,
  getPubkey: (child: number, index: bigint) => Uint8Array | null | undefined,
  opts: HdScanOptions = {},
): Promise<HdScanResult> => {
  const gapLimit = opts.gapLimit ?? 20;
  const maxAddresses = opts.maxAddresses ?? 200;

  const scanChain = async (name: 'receive' | 'change', child: 0 | 1) => {
    const used: { path: [string, number]; address: string }[] = [];
    let firstUnused: string | undefined;
    let lastDerived: string | undefined;
    let offset = 0;
    let gap = 0;
    while (offset < maxAddresses && gap < gapLimit) {
      const count = Math.min(gapLimit - gap, maxAddresses - offset);
      const batch: { path: [string, number]; address: string }[] = [];
      for (let i = 0; i < count; i++) {
        const idx = offset + i;
        const pub = getPubkey(child, BigInt(idx));
        if (!pub) break;
        const address = addressFromPublicKey(pub, 'mainnet');
        lastDerived = address;
        batch.push({ path: [name, idx], address });
      }
      if (!batch.length) break;
      const histories = await Promise.all(
        batch.map((b) => client.request<{ tx_hash: string }[]>('blockchain.scripthash.get_history', scripthashOf(b.address))),
      );
      for (let i = 0; i < batch.length; i++) {
        if (histories[i]!.length > 0) {
          used.push(batch[i]!);
          gap = 0;
        } else {
          firstUnused ??= batch[i]!.address;
          gap++;
        }
      }
      offset += batch.length;
    }
    return { used, changeCandidate: firstUnused ?? lastDerived };
  };

  const [receive, change] = await Promise.all([scanChain('receive', 0), scanChain('change', 1)]);
  const changeAddress = change.changeCandidate ?? receive.changeCandidate;
  if (!changeAddress) throw new Error('The wallet did not share its addresses yet. Try reconnecting.');

  const usedSlots = [...receive.used, ...change.used];
  const lists = await Promise.all(
    usedSlots.map((s) => client.request<Utxo[]>('blockchain.scripthash.listunspent', scripthashOf(s.address)).then((u) => ({ s, u }))),
  );
  const utxos: SpendableUtxo[] = lists.flatMap(({ s, u }) =>
    u
      .filter((x) => !x.token_data)
      .map((x) => ({ txid: x.tx_hash, vout: x.tx_pos, sats: BigInt(x.value), lockingBytecode: lockingBytecodeOf(s.address), path: s.path })),
  );
  const balance = utxos.reduce((n, u) => n + u.sats, 0n);
  return { utxos, changeAddress, balance };
};

/**
 * Loads spendable non-token UTXOs for explicit CashAddr addresses returned by
 * a WalletConnect v2 wallet (Paytaca, Cashonize, Zapit) via `bch_getAddresses`.
 */
export const scanAddressWallet = async (client: ElectrumClient, addresses: string[]): Promise<HdScanResult> => {
  const unique = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  const slots = unique.map((address, i) => ({
    address,
    lockingBytecode: lockingBytecodeOf(address),
    scripthash: scripthashOf(address),
    path: ['receive', i] as [string, number],
  }));
  if (!slots.length) throw new Error('The wallet shared no BCH addresses.');
  const lists = await Promise.all(
    slots.map((s) => client.request<Utxo[]>('blockchain.scripthash.listunspent', s.scripthash).then((u) => ({ s, u }))),
  );
  const seen = new Set<string>();
  const utxos: SpendableUtxo[] = lists.flatMap(({ s, u }) =>
    u.flatMap((x) => {
      if (x.token_data) return [];
      const outpoint = `${x.tx_hash}:${x.tx_pos}`;
      if (seen.has(outpoint)) return [];
      seen.add(outpoint);
      return [{ txid: x.tx_hash, vout: x.tx_pos, sats: BigInt(x.value), lockingBytecode: s.lockingBytecode, path: s.path }];
    }),
  );
  const balance = utxos.reduce((n, u) => n + u.sats, 0n);
  return { utxos, changeAddress: slots[0]!.address, balance };
};

/**
 * Calls `onPayment` for every transaction that pays `cashaddr` after watching starts.
 * Returns a stop function.
 */
export const watchAddress = async (
  client: ElectrumClient,
  cashaddr: string,
  onPayment: (p: IncomingPayment) => void,
): Promise<() => void> => {
  const scripthash = scripthashOf(cashaddr);
  const script = binToHex(lockingBytecodeOf(cashaddr));
  const history = async () => [
    ...(await client.request<{ tx_hash: string; height: number }[]>('blockchain.scripthash.get_history', scripthash)),
  ];
  const baseline = new Set((await history()).map((h) => h.tx_hash));
  const reported = new Map<string, { sats: bigint; confirmed: boolean }>();
  let stopped = false;
  let checking = false;
  let dirty = false;
  const check = async () => {
    if (stopped) return;
    if (checking) {
      dirty = true;
      return;
    }
    checking = true;
    try {
      do {
        dirty = false;
        try {
          for (const h of await history()) {
            if (stopped) return;
            if (baseline.has(h.tx_hash)) continue;
            const prev = reported.get(h.tx_hash);
            if (prev) {
              if (!prev.confirmed && h.height > 0) {
                prev.confirmed = true;
                if (prev.sats > 0n) onPayment({ txid: h.tx_hash, sats: prev.sats, confirmed: true });
              }
              continue;
            }
            const tx = await client.request<VerboseTx>('blockchain.transaction.get', h.tx_hash, true);
            if (stopped) return;
            const sats = tx.vout.filter((o) => o.scriptPubKey?.hex === script).reduce((n, o) => n + satsFromBch(o.value), 0n);
            const confirmed = h.height > 0;
            reported.set(h.tx_hash, { sats, confirmed });
            if (sats > 0n) onPayment({ txid: h.tx_hash, sats, confirmed });
          }
        } catch {
          // Leave failed fetches unreported so the next notification or poll retries them.
        }
      } while (dirty && !stopped);
    } finally {
      checking = false;
    }
  };
  const unsubscribe = await client.subscribeScripthash(scripthash, () => void check());
  // Some servers coalesce notifications; a slow poll covers gaps.
  const poll = setInterval(() => void check(), 12000);
  return () => {
    stopped = true;
    clearInterval(poll);
    unsubscribe();
  };
};
