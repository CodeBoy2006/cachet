import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LocalBchSigner, LocalNostrSigner, Nip07Signer, type BchSigner, type NostrSigner } from '@cachet/signers';
import { KEYS, store } from './storage.ts';

export interface NostrConnection {
  signer: NostrSigner;
  pubkey: string;
}

export interface BchConnection {
  kind: 'walletconnect' | 'local' | 'manual';
  label: string;
  /** Absent for manual signing: the user signs elsewhere and pastes the result. */
  signer?: BchSigner;
  addresses: string[];
}

interface SessionValue {
  nostr?: NostrConnection;
  bch?: BchConnection;
  restoring: boolean;
  hasSandboxKeys: boolean;
  persisted: boolean;
  connectExtension(): Promise<NostrConnection>;
  connectSandboxNostr(): NostrConnection;
  startSandbox(): { nostr: NostrConnection; bch: BchConnection };
  disconnectNostr(): void;
  setBch(conn: BchConnection | undefined): void;
  sandboxBch(): LocalBchSigner;
  sandboxNostr(): LocalNostrSigner | undefined;
  forgetSandbox(): void;
}

const Ctx = createContext<SessionValue | null>(null);

const loadSandboxNostr = () => {
  const nsec = store.get(KEYS.sandboxNostr);
  if (!nsec) return undefined;
  try {
    return LocalNostrSigner.fromNsec(nsec);
  } catch {
    return undefined;
  }
};

const checkHasSandbox = () => Boolean(store.get(KEYS.sandboxNostr) || store.get(KEYS.sandboxBch));

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [nostr, setNostr] = useState<NostrConnection>();
  const [bch, setBchState] = useState<BchConnection>();
  const [restoring, setRestoring] = useState(true);
  const [hasSandboxKeys, setHasSandboxKeys] = useState(checkHasSandbox);
  const [persisted, setPersisted] = useState(() => store.persisted);

  const syncStorageMeta = useCallback(() => {
    setHasSandboxKeys(checkHasSandbox());
    setPersisted(store.persisted);
  }, []);

  // Restore the previous choice without prompting the user.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mode = store.get(KEYS.nostrMode);
      if (mode === 'sandbox') {
        const s = loadSandboxNostr();
        if (s && !cancelled) setNostr({ signer: s, pubkey: s.pubkey });
      } else if (mode === 'nip07' && (await Nip07Signer.waitForExtension(1500))) {
        try {
          const signer = new Nip07Signer();
          const pubkey = await signer.getPublicKey();
          if (!cancelled) setNostr({ signer, pubkey });
        } catch {
          /* user may need to approve again; leave disconnected */
        }
      }
      if (!cancelled) {
        syncStorageMeta();
        setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncStorageMeta]);

  const connectExtension = useCallback(async () => {
    const signer = new Nip07Signer();
    const pubkey = await signer.getPublicKey();
    store.set(KEYS.nostrMode, 'nip07');
    syncStorageMeta();
    const conn = { signer, pubkey };
    setNostr(conn);
    return conn;
  }, [syncStorageMeta]);

  const connectSandboxNostr = useCallback(() => {
    let s = loadSandboxNostr();
    if (!s) {
      s = LocalNostrSigner.generate();
      store.set(KEYS.sandboxNostr, s.nsec);
    }
    store.set(KEYS.nostrMode, 'sandbox');
    syncStorageMeta();
    const conn = { signer: s, pubkey: s.pubkey };
    setNostr(conn);
    return conn;
  }, [syncStorageMeta]);

  const disconnectNostr = useCallback(() => {
    store.remove(KEYS.nostrMode);
    setNostr(undefined);
  }, []);

  const setBch = useCallback((conn: BchConnection | undefined) => {
    setBchState((prev) => {
      if (prev?.signer && prev.signer !== conn?.signer) void prev.signer.disconnect?.();
      return conn;
    });
  }, []);

  // A remote wallet can switch accounts or end the session at any time. Listen for as
  // long as it is the active signer, not just while the screen that connected it is mounted.
  const liveSigner = bch?.signer;
  useEffect(() => {
    if (!liveSigner) return;
    const offs = [
      liveSigner.onAddressesChanged?.((addresses) =>
        setBchState((b) => (b?.signer === liveSigner ? { ...b, label: liveSigner.label, addresses } : b)),
      ),
      liveSigner.onDisconnect?.(() => setBchState((b) => (b?.signer === liveSigner ? undefined : b))),
    ];
    return () => offs.forEach((off) => off?.());
  }, [liveSigner]);

  const sandboxBch = useCallback(() => {
    const wif = store.get(KEYS.sandboxBch);
    if (wif) {
      try {
        return LocalBchSigner.fromWif(wif);
      } catch {
        /* fall through and replace */
      }
    }
    const s = LocalBchSigner.generate('mainnet');
    store.set(KEYS.sandboxBch, s.wif);
    syncStorageMeta();
    return s;
  }, [syncStorageMeta]);

  const startSandbox = useCallback(() => {
    const n = connectSandboxNostr();
    const s = sandboxBch();
    const b: BchConnection = { kind: 'local', label: 'Sandbox key', signer: s, addresses: [s.address()] };
    setBch(b);
    return { nostr: n, bch: b };
  }, [connectSandboxNostr, sandboxBch, setBch]);

  const forgetSandbox = useCallback(() => {
    store.remove(KEYS.sandboxBch);
    store.remove(KEYS.sandboxNostr);
    if (store.get(KEYS.nostrMode) === 'sandbox') store.remove(KEYS.nostrMode);
    syncStorageMeta();
    setNostr((n) => (n?.signer.type === 'local' ? undefined : n));
    setBchState((b) => (b?.kind === 'local' ? undefined : b));
  }, [syncStorageMeta]);

  const value = useMemo<SessionValue>(
    () => ({
      nostr,
      bch,
      restoring,
      hasSandboxKeys,
      persisted,
      connectExtension,
      connectSandboxNostr,
      startSandbox,
      disconnectNostr,
      setBch,
      sandboxBch,
      sandboxNostr: loadSandboxNostr,
      forgetSandbox,
    }),
    [nostr, bch, restoring, hasSandboxKeys, persisted, connectExtension, connectSandboxNostr, startSandbox, disconnectNostr, setBch, sandboxBch, forgetSandbox],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useSession = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
};

/** True when this browser holds the sandbox BCH key for `cashaddr`. */
export const isSandboxAddress = (cashaddr: string) => {
  const wif = store.get(KEYS.sandboxBch);
  if (!wif) return false;
  try {
    const s = LocalBchSigner.fromWif(wif);
    return s.address() === cashaddr || s.address(true) === cashaddr;
  } catch {
    return false;
  }
};
