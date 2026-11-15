import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nsecEncode, decode } from 'nostr-tools/nip19';
import { checkEventSignature, rebuildEvent, type EventTemplate, type NostrEvent } from '@cachet/core';

export interface NostrSigner {
  readonly type: 'nip07' | 'local';
  readonly label: string;
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<NostrEvent>;
}

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<unknown>;
}

const nip07 = (): Nip07 | undefined => (globalThis as { nostr?: Nip07 }).nostr;

/**
 * Whatever comes back from a signer is untrusted: rebuild it, check id and
 * signature, and confirm it is the event we asked for, by the key we expected.
 */
export const acceptSignedEvent = (raw: unknown, template: EventTemplate, expectedPubkey: string): NostrEvent => {
  const rebuilt = rebuildEvent(raw);
  if (!rebuilt.ok) throw new Error(`Signer returned a malformed event (${rebuilt.detail})`);
  const e = rebuilt.event;
  if (e.pubkey !== expectedPubkey) throw new Error('Signer used a different Nostr key than the one connected');
  if (
    e.kind !== template.kind ||
    e.created_at !== template.created_at ||
    e.content !== template.content ||
    JSON.stringify(e.tags) !== JSON.stringify(template.tags)
  ) {
    throw new Error('Signer changed the event before signing');
  }
  if (!checkEventSignature(e).ok) throw new Error('Signer returned an invalid signature');
  return e;
};

export class Nip07Signer implements NostrSigner {
  readonly type = 'nip07' as const;
  readonly label = 'Browser extension';
  private pubkey?: string;

  static available(): boolean {
    return typeof nip07()?.signEvent === 'function';
  }

  /** Extensions inject window.nostr after load; give them a moment. */
  static async waitForExtension(ms = 1200): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (Nip07Signer.available()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return Nip07Signer.available();
  }

  async getPublicKey(): Promise<string> {
    const ext = nip07();
    if (!ext) throw new Error('No NIP-07 extension found');
    const pk = await ext.getPublicKey();
    if (typeof pk !== 'string' || !/^[0-9a-f]{64}$/.test(pk)) throw new Error('Extension returned an invalid public key');
    this.pubkey = pk;
    return pk;
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    const ext = nip07();
    if (!ext) throw new Error('No NIP-07 extension found');
    const expected = this.pubkey ?? (await this.getPublicKey());
    // The user may have switched accounts in the extension since connecting.
    const current = await ext.getPublicKey();
    if (current !== expected) throw new Error('The extension switched to a different Nostr account');
    return acceptSignedEvent(await ext.signEvent(structuredClone(template)), template, expected);
  }
}

/** A key held in memory (sandbox mode). The app decides where, if anywhere, to persist it. */
export class LocalNostrSigner implements NostrSigner {
  readonly type = 'local' as const;
  readonly label = 'Sandbox key';
  readonly pubkey: string;

  constructor(private readonly secret: Uint8Array) {
    this.pubkey = getPublicKey(secret);
  }

  static generate() {
    return new LocalNostrSigner(generateSecretKey());
  }

  static fromNsec(nsec: string) {
    const d = decode(nsec.trim());
    if (d.type !== 'nsec') throw new Error('Not an nsec');
    return new LocalNostrSigner(d.data);
  }

  get nsec() {
    return nsecEncode(this.secret);
  }

  async getPublicKey() {
    return this.pubkey;
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    return acceptSignedEvent(finalizeEvent(template, this.secret), template, this.pubkey);
  }
}
