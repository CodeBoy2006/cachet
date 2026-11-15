import {
  binToHex,
  decodeCashAddress,
  encodeCashAddress,
  encodeLockingBytecodeP2pkh,
  hash160,
} from '@bitauth/libauth';
import type { Network } from './constants.ts';

export type AddressType = 'p2pkh' | 'p2pkhWithTokens' | 'p2sh' | 'p2shWithTokens';

export interface ParsedAddress {
  /** Canonical form: lowercase with prefix. */
  address: string;
  prefix: 'bitcoincash' | 'bchtest' | 'bchreg';
  network: Network | 'regtest';
  type: AddressType;
  payload: Uint8Array;
  /** Type bits 2/3: the receiver declared it accepts CashTokens. */
  tokenAware: boolean;
  /** Single-key P2PKH (plain or token-aware): the only kind a message signature can prove. */
  singleKey: boolean;
}

export type AddressError = { error: 'address_invalid' | 'unsupported_address_type'; detail: string };

const PREFIX_NETWORK = { bitcoincash: 'mainnet', bchtest: 'chipnet', bchreg: 'regtest' } as const;
const NETWORK_PREFIX = { mainnet: 'bitcoincash', chipnet: 'bchtest' } as const;

export const networkOfPrefix = (prefix: ParsedAddress['prefix']) => PREFIX_NETWORK[prefix];
export const prefixOfNetwork = (network: Network) => NETWORK_PREFIX[network];

/**
 * Strict parser for addresses inside signed statements: the full lowercase
 * `prefix:payload` form only.
 */
export const parseCashAddr = (input: unknown): ParsedAddress | AddressError => {
  if (typeof input !== 'string' || input.length > 128) {
    return { error: 'address_invalid', detail: 'not a string' };
  }
  if (input !== input.toLowerCase()) {
    return { error: 'address_invalid', detail: 'must be lowercase' };
  }
  if (!input.includes(':')) return { error: 'address_invalid', detail: 'missing network prefix' };
  const decoded = decodeCashAddress(input);
  if (typeof decoded === 'string') return { error: 'address_invalid', detail: decoded };
  const type = decoded.type as AddressType;
  return {
    address: input,
    prefix: decoded.prefix,
    network: PREFIX_NETWORK[decoded.prefix],
    type,
    payload: decoded.payload,
    tokenAware: type === 'p2pkhWithTokens' || type === 'p2shWithTokens',
    singleKey: (type === 'p2pkh' || type === 'p2pkhWithTokens') && decoded.payload.length === 20,
  };
};

/**
 * Lenient parser for user input: trims, accepts missing prefix and all-uppercase
 * (as printed by QR codes). Returns the canonical form.
 */
export const normalizeCashAddrInput = (
  raw: string,
  defaultNetwork: Network = 'mainnet',
): ParsedAddress | AddressError => {
  let value = raw.trim();
  if (value.toLowerCase().startsWith('bch:')) value = value.slice(4);
  const lower = value.toLowerCase();
  if (value !== lower && value !== value.toUpperCase()) {
    return { error: 'address_invalid', detail: 'mixed case' };
  }
  const withPrefix = lower.includes(':') ? lower.split('?')[0]! : `${NETWORK_PREFIX[defaultNetwork]}:${lower}`;
  return parseCashAddr(withPrefix);
};

export const isAddressError = (v: ParsedAddress | AddressError): v is AddressError => 'error' in v;

/** P2PKH locking bytecode: the token-aware and plain forms of one key lock the same script. */
export const lockingBytecodeHex = (parsed: ParsedAddress): string =>
  parsed.type === 'p2pkh' || parsed.type === 'p2pkhWithTokens'
    ? binToHex(encodeLockingBytecodeP2pkh(parsed.payload))
    : `p2sh:${binToHex(parsed.payload)}`;

export const sameController = (a: ParsedAddress, b: ParsedAddress) =>
  a.network === b.network && lockingBytecodeHex(a) === lockingBytecodeHex(b);

export const addressFromPublicKey = (
  publicKey: Uint8Array,
  network: Network,
  tokenAware = false,
): string =>
  encodeCashAddress({
    prefix: NETWORK_PREFIX[network],
    type: tokenAware ? 'p2pkhWithTokens' : 'p2pkh',
    payload: hash160(publicKey),
  }).address;

/** Same key, other type: q… ⇄ z…. Only for P2PKH. */
export const toggleTokenForm = (parsed: ParsedAddress): string | null => {
  if (!parsed.singleKey || parsed.prefix === 'bchreg') return null;
  return encodeCashAddress({
    prefix: parsed.prefix,
    type: parsed.tokenAware ? 'p2pkh' : 'p2pkhWithTokens',
    payload: parsed.payload,
  }).address;
};

export const shortAddress = (address: string, head = 6, tail = 6): string => {
  const body = address.includes(':') ? address.split(':')[1]! : address;
  return body.length <= head + tail + 1 ? body : `${body.slice(0, head)}…${body.slice(-tail)}`;
};
