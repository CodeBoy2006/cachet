/**
 * Builds an unsigned P2PKH payment for a wallet to sign (WizardConnect / WalletConnect).
 * Inputs carry empty unlocking bytecode; the wallet fills them in.
 * Token-carrying UTXOs are never selected, so a payment cannot burn CashTokens.
 */
import { hexToBin, type Input, type Output, type TransactionCommon } from '@bitauth/libauth';

export const DUST_SATS = 546n;
const INPUT_BYTES = 148n; // P2PKH input, ECDSA worst case
const OUTPUT_BYTES = 34n;
const OVERHEAD_BYTES = 10n;

export interface SpendableUtxo {
  txid: string;
  vout: number;
  sats: bigint;
  lockingBytecode: Uint8Array;
  /** Where the wallet derives the key: [path name, address index]. */
  path: [string, number];
}

export interface PaymentPlan {
  transaction: TransactionCommon;
  sourceOutputs: (Input & Output)[];
  inputPaths: [number, string, number][];
  fee: bigint;
  change: bigint;
}

export const estimateFee = (inputs: number, outputs: number, satsPerByte = 1n) =>
  (OVERHEAD_BYTES + INPUT_BYTES * BigInt(inputs) + OUTPUT_BYTES * BigInt(outputs)) * satsPerByte;

export const planPayment = (input: {
  utxos: SpendableUtxo[];
  to: Uint8Array;
  sats: bigint;
  changeTo: Uint8Array;
  satsPerByte?: bigint;
}): PaymentPlan => {
  if (input.sats < DUST_SATS) throw new Error(`Minimum payment is ${DUST_SATS} sats`);
  const rate = input.satsPerByte ?? 1n;
  // Largest first keeps the input count (and fee) low.
  const pool = [...input.utxos].sort((a, b) => (b.sats > a.sats ? 1 : b.sats < a.sats ? -1 : 0));
  let best: { count: number; fee: bigint; change: bigint } | undefined;
  let total = 0n;
  for (let i = 0; i < pool.length; i++) {
    total += pool[i]!.sats;
    const count = i + 1;
    const fee2 = estimateFee(count, 2, rate);
    if (total >= input.sats + fee2 + DUST_SATS) {
      const cand = { count, fee: fee2, change: total - input.sats - fee2 };
      if (!best || cand.fee < best.fee) best = cand;
      break;
    }
    const fee1 = estimateFee(count, 1, rate);
    if (total >= input.sats + fee1) {
      const cand = { count, fee: total - input.sats, change: 0n };
      if (!best || cand.fee < best.fee) best = cand;
    }
  }
  if (!best) throw new Error('Not enough BCH in this wallet for the payment and network fee');
  const chosen = pool.slice(0, best.count);
  const { fee, change } = best;

  const inputs: Input[] = chosen.map((u) => ({
    outpointTransactionHash: hexToBin(u.txid),
    outpointIndex: u.vout,
    sequenceNumber: 0xffffffff,
    unlockingBytecode: new Uint8Array(),
  }));
  const outputs: Output[] = [{ lockingBytecode: input.to, valueSatoshis: input.sats }];
  if (change > 0n) outputs.push({ lockingBytecode: input.changeTo, valueSatoshis: change });

  return {
    transaction: { version: 2, inputs, outputs, locktime: 0 },
    sourceOutputs: chosen.map((u, i) => ({ ...inputs[i]!, lockingBytecode: u.lockingBytecode, valueSatoshis: u.sats })),
    inputPaths: chosen.map((u, i) => [i, u.path[0], u.path[1]]),
    fee,
    change,
  };
};
