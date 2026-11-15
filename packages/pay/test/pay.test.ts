import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { binToHex, encodeTransaction, hexToBin, secp256k1 } from '@bitauth/libauth';
import { addressFromPublicKey } from '@cachet/core';
import { DUST_SATS, ElectrumClient, ensureBroadcast, formatBch, lockingBytecodeOf, parseBch, paymentUri, planPayment, scanHdWallet, scripthashOf, watchAddress } from '../src/index.ts';

const addr = 'bitcoincash:qqehccy89v7ftlfgr9v0zvhjzyy7eatdkqt05lt3nw';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('amounts and BIP21', () => {
  it('formats and parses without floating point', () => {
    expect(formatBch(100000n)).toBe('0.001');
    expect(formatBch(123456789n)).toBe('1.23456789');
    expect(parseBch('0.00000001')).toBe(1n);
    expect(parseBch('0.000000001')).toBeNull();
    expect(parseBch('1e3')).toBeNull();
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 2_100_000_000_000_000n }), (s) => {
      expect(parseBch(formatBch(s))).toBe(s);
    }));
  });

  it('builds payment URIs', () => {
    expect(paymentUri(addr, { sats: 50000n, label: 'Tip for alice' })).toBe(`${addr}?amount=0.0005&label=Tip%20for%20alice`);
    expect(paymentUri(addr)).toBe(addr);
  });

  it('computes Electrum script hashes', () => {
    expect(scripthashOf(addr)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('planPayment', () => {
  const to = lockingBytecodeOf(addr);
  const utxo = (sats: bigint, i: number) => ({ txid: `${i}`.padStart(64, '0'), vout: 0, sats, lockingBytecode: to, path: ['receive', i] as [string, number] });

  it('selects inputs, adds change and maps input paths', () => {
    const plan = planPayment({ utxos: [utxo(5000n, 1), utxo(200000n, 2)], to, sats: 100000n, changeTo: to });
    expect(plan.inputPaths).toEqual([[0, 'receive', 2]]);
    expect(plan.transaction.outputs.map((o) => o.valueSatoshis)).toEqual([100000n, 200000n - 100000n - plan.fee]);
    expect(encodeTransaction(plan.transaction).length).toBeGreaterThan(0);
  });

  it('folds dust change into the fee without consuming extra UTXOs unnecessarily', () => {
    const plan = planPayment({ utxos: [utxo(100300n, 1)], to, sats: 100000n, changeTo: to });
    expect(plan.change).toBe(0n);
    expect(plan.transaction.outputs).toHaveLength(1);
    expect(plan.fee).toBe(300n);

    const noExtraBurn = planPayment({ utxos: [utxo(1200n, 1), utxo(546n, 2)], to, sats: 1000n, changeTo: to });
    expect(noExtraBurn.inputPaths).toEqual([[0, 'receive', 1]]);
    expect(noExtraBurn.fee).toBe(200n);

    const ignoresTinyTrailing = planPayment({ utxos: [utxo(1200n, 1), utxo(100n, 2)], to, sats: 1000n, changeTo: to });
    expect(ignoresTinyTrailing.inputPaths).toEqual([[0, 'receive', 1]]);
    expect(ignoresTinyTrailing.fee).toBe(200n);
  });

  it('refuses dust payments and insufficient funds', () => {
    expect(() => planPayment({ utxos: [utxo(10000n, 1)], to, sats: DUST_SATS - 1n, changeTo: to })).toThrow();
    expect(() => planPayment({ utxos: [utxo(1000n, 1)], to, sats: 1000n, changeTo: to })).toThrow(/Not enough/);
    expect(hexToBin('00')).toHaveLength(1);
  });
});

describe('ElectrumClient', () => {
  class Socket {
    static instances: Socket[] = [];
    readyState = 0;
    onopen?: () => void;
    onmessage?: (m: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    send = vi.fn<(data: string) => void>();
    close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
    constructor(readonly url: string) { Socket.instances.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    reply(data: string) { this.onmessage?.({ data }); }
  }

  const mockSockets = () => {
    Socket.instances = [];
    vi.stubGlobal('WebSocket', Socket);
  };

  it('shares one validated version handshake between concurrent connections', async () => {
    mockSockets();
    const client = new ElectrumClient(['wss://test']);
    const first = client.connect();
    expect(client.connect()).toBe(first);
    expect(Socket.instances).toHaveLength(1);
    const ws = Socket.instances[0]!;
    ws.open();
    expect(JSON.parse(ws.send.mock.calls[0]![0])).toMatchObject({ id: 0, method: 'server.version' });
    ws.reply(JSON.stringify({ id: 0, result: ['Fulcrum', '1.4'] }));
    await first;
    await client.connect();
    expect(Socket.instances).toHaveLength(1);
    client.close();
  });

  it.each([
    JSON.stringify({ id: 0, error: { message: 'unsupported protocol' } }),
    JSON.stringify({ id: 1, result: ['Fulcrum', '1.4'] }),
    JSON.stringify({ id: 0, result: 'not an array' }),
    'not JSON',
    'null',
  ])('rejects an invalid version handshake: %s', async (response) => {
    mockSockets();
    const client = new ElectrumClient(['wss://test']);
    const connected = client.connect();
    const ws = Socket.instances[0]!;
    ws.open();
    ws.reply(response);
    await expect(connected).rejects.toThrow('No Electrum server reachable');
    expect(ws.close).toHaveBeenCalledOnce();
  });

  it.each(['close', 'remote close'])('clears pending request timers on %s', async (action) => {
    vi.useFakeTimers();
    mockSockets();
    const client = new ElectrumClient(['wss://test']);
    const connected = client.connect();
    const ws = Socket.instances[0]!;
    ws.open();
    ws.reply(JSON.stringify({ id: 0, result: ['Fulcrum', '1.4'] }));
    await connected;
    const pending = client.request('test');
    const rejected = expect(pending).rejects.toThrow('Electrum connection closed');
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    if (action === 'close') client.close();
    else ws.close();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a delayed close from a previous connection', async () => {
    mockSockets();
    const client = new ElectrumClient(['wss://test']);
    const open = async () => {
      const connected = client.connect();
      const ws = Socket.instances.at(-1)!;
      ws.open();
      ws.reply(JSON.stringify({ id: 0, result: ['Fulcrum', '1.4'] }));
      await connected;
      return ws;
    };
    const old = await open();
    const delayedClose = old.onclose!;
    client.close();
    const ws = await open();
    const pending = client.request('test');
    await Promise.resolve();
    delayedClose();
    ws.reply(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(pending).resolves.toBe('ok');
    client.close();
  });

  it('connects afresh when close() lands mid-handshake and connect() is called again right away', async () => {
    // React StrictMode unmounts and remounts effects synchronously: close() then connect() in one tick.
    mockSockets();
    const client = new ElectrumClient(['wss://test']);
    const first = client.connect();
    const firstRejected = expect(first).rejects.toThrow('Electrum connection closed');
    client.close();
    const second = client.connect();
    expect(second).not.toBe(first);
    const ws = Socket.instances.at(-1)!;
    expect(Socket.instances).toHaveLength(2);
    ws.open();
    ws.reply(JSON.stringify({ id: 0, result: ['Fulcrum', '1.4'] }));
    await firstRejected;
    await expect(second).resolves.toBeUndefined();
    expect(client.server).toBe('wss://test');
    // The first attempt settling late must not clear the second one's state.
    const third = client.connect();
    await expect(third).resolves.toBeUndefined();
    expect(Socket.instances).toHaveLength(2);
    client.close();
  });

  it('closes in-flight sockets and rejects if close() is called before handshake finishes', async () => {
    mockSockets();
    const client = new ElectrumClient(['wss://test']);
    const pending = client.connect();
    const ws = Socket.instances[0]!;
    client.close();
    await expect(pending).rejects.toThrow('Electrum connection closed');
    expect(ws.readyState).toBe(3);
    expect(client.server).toBeUndefined();
  });
});

describe('watchAddress', () => {
  it('retries failed fetches, queues overlapping checks and reports confirmation once', async () => {
    vi.useFakeTimers();
    const client = new ElectrumClient([]);
    let entries = [{ tx_hash: 'baseline', height: 1 }];
    let notify!: () => void;
    const unsubscribe = vi.fn();
    vi.spyOn(client, 'subscribeScripthash').mockImplementation(async (_hash, cb) => {
      notify = () => cb([]);
      return unsubscribe;
    });
    let finishFetch!: (tx: unknown) => void;
    const fetchTx = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishFetch = resolve; }));
    const request = vi.spyOn(client, 'request').mockImplementation(async (method) => {
      if (method === 'blockchain.scripthash.get_history') return [...entries];
      if (method === 'blockchain.transaction.get') return fetchTx();
      throw new Error(`Unexpected method ${method}`);
    });
    const onPayment = vi.fn();
    const stop = await watchAddress(client, addr, onPayment);
    try {
      entries = [...entries, { tx_hash: 'payment', height: 0 }];
      notify();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchTx).toHaveBeenCalledTimes(1);
      expect(onPayment).not.toHaveBeenCalled();

      notify();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchTx).toHaveBeenCalledTimes(2);
      entries = [entries[0]!, { tx_hash: 'payment', height: 100 }];
      notify(); // Arrives while the transaction fetch is still in flight.
      finishFetch({ txid: 'payment', vout: [{ value: '0.00001', scriptPubKey: { hex: binToHex(lockingBytecodeOf(addr)) } }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(onPayment.mock.calls.map(([p]) => p)).toEqual([
        { txid: 'payment', sats: 1000n, confirmed: false },
        { txid: 'payment', sats: 1000n, confirmed: true },
      ]);
      notify();
      await vi.advanceTimersByTimeAsync(12000);
      expect(onPayment).toHaveBeenCalledTimes(2);
      expect(fetchTx).toHaveBeenCalledTimes(2);
      expect(request).not.toHaveBeenCalledWith('blockchain.transaction.get', 'baseline', true);
    } finally {
      stop();
    }
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ensureBroadcast', () => {
  it('accepts a successful broadcast', async () => {
    const client = new ElectrumClient([]);
    const request = vi.spyOn(client, 'request').mockResolvedValue('txid');
    await ensureBroadcast(client, 'raw', 'txid');
    expect(request.mock.calls).toEqual([['blockchain.transaction.broadcast', 'raw']]);
  });

  it('accepts a transaction already broadcast by the wallet only when Fulcrum can retrieve it', async () => {
    const client = new ElectrumClient([]);
    const request = vi.spyOn(client, 'request').mockRejectedValueOnce(new Error('already known')).mockResolvedValueOnce('raw');
    await ensureBroadcast(client, 'raw', 'txid');
    expect(request.mock.calls).toEqual([['blockchain.transaction.broadcast', 'raw'], ['blockchain.transaction.get', 'txid']]);
  });

  it.each(['invalid transaction', 'unknown error'])('rethrows %s if the transaction cannot be found', async (msg) => {
    const client = new ElectrumClient([]);
    const failure = new Error(msg);
    vi.spyOn(client, 'request').mockRejectedValueOnce(failure).mockRejectedValueOnce(new Error('not found'));
    await expect(ensureBroadcast(client, 'raw', 'txid')).rejects.toBe(failure);
  });
});

describe('scanHdWallet', () => {
  const pubkeyAt = (child: number, index: bigint) => {
    const sk = new Uint8Array(32);
    sk[29] = child + 1;
    sk[30] = Number(index >> 8n) & 255;
    sk[31] = (Number(index) & 255) + 1;
    const pk = secp256k1.derivePublicKeyCompressed(sk);
    if (typeof pk === 'string') throw new Error(pk);
    return pk;
  };
  const addrAt = (child: number, idx: number) => addressFromPublicKey(pubkeyAt(child, BigInt(idx)), 'mainnet');

  it('scans past index 20 via BIP44 gap limit, skips token UTXOs and picks the first unused change address', async () => {
    const client = new ElectrumClient([]);
    const deepReceive = scripthashOf(addrAt(0, 18));
    const deeperReceive = scripthashOf(addrAt(0, 34));
    const usedChange0 = scripthashOf(addrAt(1, 0));
    const usedChange1 = scripthashOf(addrAt(1, 1));
    vi.spyOn(client, 'request').mockImplementation(async (method, hash) => {
      if (method === 'blockchain.scripthash.get_history') {
        return [deepReceive, deeperReceive, usedChange0, usedChange1].includes(String(hash)) ? [{ tx_hash: 'aa'.repeat(32), height: 1 }] : [];
      }
      if (method === 'blockchain.scripthash.listunspent') {
        if (hash === deeperReceive) {
          return [
            { tx_hash: '11'.repeat(32), tx_pos: 0, value: 42000, height: 10 },
            { tx_hash: '22'.repeat(32), tx_pos: 1, value: 1000, height: 10, token_data: { category: 'ff'.repeat(32) } },
          ];
        }
        return [];
      }
      throw new Error(`unexpected ${method}`);
    });

    const res = await scanHdWallet(client, pubkeyAt);
    expect(res.balance).toBe(42000n);
    expect(res.utxos).toHaveLength(1);
    expect(res.utxos[0]?.path).toEqual(['receive', 34]);
    expect(res.changeAddress).toBe(addrAt(1, 2));
  });
});
