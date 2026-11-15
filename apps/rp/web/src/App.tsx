import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_CODES } from '@cachet/core';
import { Nip07Signer } from '@cachet/signers';
import {
  Avatar,
  IconArrowUpRight,
  IconCheck,
  IconRefresh,
  IconX,
  Logo,
  Note,
  Spinner,
  formatDateTime,
  relayHost,
  shortCashaddr,
  shortNpub,
} from '@cachet/react';
import { brandOf } from '../../shared/brands.ts';
import { LoginError, completeRedirect, getLog, getSession, login, logout, openChallenge, recheck, type LogEntry, type LoginStep, type SessionInfo } from './api.ts';
import { CACHET_URL, extensionSigner, startRedirect, takeRedirectResult } from './signers.ts';
import { BrandMark, FieldnoteContent, StallContent } from './content.tsx';

const brand = brandOf(import.meta.env.VITE_RP);
const STEPS: { id: LoginStep; label: string }[] = [
  { id: 'identity', label: 'Your Nostr key' },
  { id: 'challenge', label: `${brand.name} issues a one-time challenge` },
  { id: 'sign', label: 'You sign it' },
  { id: 'verify', label: `${brand.name} checks the signature and your BCH link on relays` },
];

type Flow = { step: LoginStep; details: Partial<Record<LoginStep, string>>; error?: { code: string; message: string } };

// Runs once at load: a sign-in coming back from Cachet carries the signed request in the URL fragment.
const redirect = takeRedirectResult();
const redirectLogin = redirect.kind === 'signed' ? completeRedirect(redirect.body, redirect.event) : null;
const redirectPubkey = redirect.kind === 'signed' ? String((redirect.event as { pubkey?: unknown })?.pubkey ?? '') : '';

const initialFlow = (): Flow | undefined => {
  if (redirect.kind === 'signed') return { step: 'verify', details: { identity: redirectPubkey } };
  if (redirect.kind === 'cancelled') return { step: 'sign', details: {}, error: { code: 'cancelled', message: 'You cancelled the sign-in.' } };
  if (redirect.kind === 'error') return { step: 'sign', details: {}, error: { code: 'auth_malformed', message: redirect.message } };
  return undefined;
};

const SignIn = ({ onSession }: { onSession: (s: SessionInfo) => void }) => {
  const [flow, setFlow] = useState<Flow | undefined>(initialFlow);
  const [hasExt, setHasExt] = useState(false);
  useEffect(() => {
    void Nip07Signer.waitForExtension(1200).then(setHasExt);
  }, []);

  const fail = (e: unknown) => {
    const code = e instanceof LoginError ? e.code : 'cancelled';
    const message = e instanceof Error ? e.message : String(e);
    setFlow((f) => ({ step: f?.step ?? 'identity', details: f?.details ?? {}, error: { code, message } }));
  };

  useEffect(() => {
    if (!redirectLogin) return;
    let live = true;
    redirectLogin.then((s) => live && onSession(s)).catch((e) => live && fail(e));
    return () => {
      live = false;
    };
  }, [onSession]);

  const viaCachet = async () => {
    setFlow({ step: 'challenge', details: {} });
    try {
      startRedirect(brand.name, await openChallenge());
    } catch (e) {
      fail(e);
    }
  };

  const viaExtension = async () => {
    setFlow({ step: 'identity', details: {} });
    try {
      const session = await login(extensionSigner, (step, detail) =>
        setFlow((f) => ({ step, details: { ...f?.details, ...(detail ? { [step === 'challenge' ? 'identity' : 'challenge']: detail } : {}) } })),
      );
      onSession(session);
    } catch (e) {
      fail(e);
    }
  };

  const busy = flow && !flow.error;
  const idx = flow ? STEPS.findIndex((s) => s.id === flow.step) : -1;

  return (
    <div className="c-card signin">
      <h2>Sign in to {brand.name}</h2>
      <p className="soft">With your Nostr key and its linked BCH address. No password, no email.</p>
      <div className="signin__buttons">
        <button type="button" className="c-btn c-btn--lg brand-btn" onClick={viaCachet} disabled={busy}>
          <Logo size={18} /> Sign in with Cachet
        </button>
        <button type="button" className="c-btn c-btn--lg c-btn--secondary" onClick={viaExtension} disabled={busy || !hasExt} title={hasExt ? '' : 'No NIP-07 extension detected'}>
          Browser extension
        </button>
      </div>
      {flow && (
        <ol className="flow">
          {STEPS.map((s, i) => {
            const state = flow.error && i === idx ? 'fail' : i < idx ? 'done' : i === idx ? (flow.error ? 'fail' : 'now') : 'todo';
            const detail = s.id === 'identity' && flow.details.identity ? shortNpub(flow.details.identity) : s.id === 'challenge' ? flow.details.challenge : undefined;
            return (
              <li key={s.id} data-state={state}>
                <span className="flow__mark">{state === 'done' ? <IconCheck size={12} strokeWidth={2.2} /> : state === 'fail' ? <IconX size={11} strokeWidth={2.2} /> : state === 'now' ? <Spinner /> : null}</span>
                <span>{s.label}</span>
                {detail && <span className="mono muted flow__detail">{detail}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {flow?.error && (
        <Note tone={flow.error.code === 'cancelled' ? 'info' : 'danger'}>
          {flow.error.code !== 'cancelled' && (
            <>
              <span className="mono" style={{ fontSize: 12.5 }}>
                {flow.error.code}
              </span>{' '}
              ·{' '}
            </>
          )}
          {flow.error.message || AUTH_CODES[flow.error.code as keyof typeof AUTH_CODES]}
          {flow.error.code === 'binding_inactive' && (
            <>
              {' '}
              <a href={`${CACHET_URL}/new`} target="_blank" rel="noreferrer">
                Link a BCH address
              </a>
            </>
          )}
        </Note>
      )}
      <p className="muted signin__foot">
        {brand.name} runs its own check against Nostr relays. It never asks Cachet whether you are who you say.
      </p>
    </div>
  );
};

const SessionCard = ({ session, onChange }: { session: SessionInfo; onChange: (s: SessionInfo | null, message?: string) => void }) => {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const check = async () => {
    setBusy(true);
    try {
      const r = await recheck();
      if (!alive.current) return;
      if (r.ok) onChange(r.session as SessionInfo);
      else if (r.revoked === false) onChange(session, r.message);
      else onChange(null, r.message ?? 'Signed out.');
    } catch {
      if (alive.current) onChange(session, 'Could not reach the server to re-check right now.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const signOut = () => {
    alive.current = false;
    onChange(null);
    void logout().catch(() => {});
  };
  return (
    <div className="c-card session">
      <div className="row" style={{ gap: 12 }}>
        <Avatar pubkey={session.pubkey} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{session.name ?? shortNpub(session.pubkey)}</div>
          <div className="mono muted" style={{ fontSize: 12.5 }}>
            {shortNpub(session.pubkey)}
          </div>
        </div>
        <span className="c-pill c-pill--active">Verified</span>
      </div>
      <dl className="kv">
        <dt>BCH</dt>
        <dd>{shortCashaddr(session.cashaddr, 10, 8)}</dd>
        <dt>Checked</dt>
        <dd>{formatDateTime(session.checkedAt)}</dd>
        <dt>Relays</dt>
        <dd>
          {session.relays.filter((r) => r.status === 'ok').length} of {session.relays.length} answered
        </dd>
        <dt>Snapshot</dt>
        <dd>{session.snapshotId.slice(0, 16)}…</dd>
      </dl>
      <div className="row">
        <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={check} disabled={busy}>
          {busy ? <Spinner /> : <IconRefresh size={14} />} Re-check link
        </button>
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
};

const ServerLog = ({ tick }: { tick: number }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void getLog().then((e) => live && setEntries(e)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [tick]);
  return (
    <section className="log">
      <h3 className="c-section-title">{brand.name} server log</h3>
      {entries.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Nothing yet. Sign in to see each decision this server makes.
        </p>
      ) : (
        <ul>
          {entries.map((e, i) => (
            <li key={`${e.t}-${i}`} data-tone={e.tone}>
              <span className="log__t mono">{new Date(e.t * 1000).toLocaleTimeString([], { hour12: false })}</span>
              <span className="log__dot" />
              <span className="log__text">{e.text}</span>
              {e.code && <span className="mono log__code">{e.code}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export const App = () => {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [notice, setNotice] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand', brand.accent);
    document.documentElement.style.setProperty('--brand-dark', brand.accentDark);
    void getSession().then(setSession);
  }, []);
  const update = useCallback((s: SessionInfo | null, message?: string) => {
    setSession(s);
    setNotice(message);
    setTick((t) => t + 1);
  }, []);

  return (
    <div className={`rp rp--${brand.id}`}>
      <header className="rp-head">
        <div className="wrap">
          <span className="rp-brand">
            <BrandMark id={brand.id} /> {brand.name}
          </span>
          <span className="rp-tag">Example app</span>
          <a className="rp-cachet" href={CACHET_URL} target="_blank" rel="noreferrer">
            Identity by Cachet <IconArrowUpRight size={13} />
          </a>
        </div>
      </header>
      <main className="wrap rp-main">
        <div className="rp-intro">
          <h1>{brand.tagline}</h1>
          <p className="soft">
            {brand.id === 'a'
              ? 'Short notes for people who pay with BCH. Members sign in with Nostr; no account to create.'
              : 'Open a stall with your Nostr key. Buyers pay the BCH address you proved you control, so nobody can swap it.'}
          </p>
        </div>
        <div className="rp-grid">
          <div>{brand.id === 'a' ? <FieldnoteContent session={session ?? null} /> : <StallContent session={session ?? null} />}</div>
          <div className="rp-side">
            {notice && <Note tone="warn">{notice}</Note>}
            {session === undefined ? (
              <div className="c-card signin row muted">
                <Spinner /> Checking session…
              </div>
            ) : session ? (
              <SessionCard session={session} onChange={update} />
            ) : (
              <SignIn onSession={update} />
            )}
            <ServerLog tick={tick} />
          </div>
        </div>
      </main>
      <footer className="wrap rp-foot muted">
        {brand.name} is a demo relying party: its own server, its own sessions, its own relay checks. Relays:{' '}
        {session?.relays.map((r) => relayHost(r.url)).join(', ') || 'configured on the server'}.
      </footer>
    </div>
  );
};
