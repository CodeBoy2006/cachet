import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { KIND_HTTP_AUTH, fromBase64Url, isLowerHex, npubEncode, nowSeconds, toBase64Url, type EventTemplate } from '@cachet/core';
import { Avatar, IconArrowRight, IconCheck, IconZap, Logo, Note, Spinner, StatePill, shortCashaddr, shortNpub } from '@cachet/react';
import { config } from '../config.ts';
import { useSession } from '../lib/session.tsx';
import { savePendingSign } from '../lib/storage.ts';
import { useLookup } from '../lib/useLookup.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';
import { prefersReducedMotion } from '../lib/motion.ts';
import { NostrConnect } from '../components/NostrConnect.tsx';

/**
 * Sign-in for apps that cannot reach a NIP-07 extension (redirect flow).
 *
 *   /sign?app=<name>&return=<url>&req=<base64url(kind 27235 template)>
 *
 * Signs exactly one HTTP-auth request whose URL is on the return origin, then sends
 * the event back in the URL fragment. The app verifies everything itself; this page
 * only holds the key.
 */
type Request = { app: string; returnUrl: string; origin: string; template: EventTemplate };

/** One of the example apps this site was built with, matched by origin: a name in the URL proves nothing. */
const knownApp = (origin: string) =>
  config.apps.find((a) => {
    try {
      return new URL(a.url).origin === origin;
    } catch {
      return false;
    }
  });

const parseRequest = (): Request | { error: string } => {
  const q = new URLSearchParams(location.search);
  const ret = q.get('return');
  const req = q.get('req');
  if (!ret || !req) return { error: 'missing' };
  let returnUrl: URL;
  try {
    returnUrl = new URL(ret);
  } catch {
    return { error: 'The app sent an invalid return address.' };
  }
  if (returnUrl.protocol !== 'https:' && returnUrl.protocol !== 'http:') return { error: 'The app sent an invalid return address.' };
  const json = fromBase64Url(req);
  let t: EventTemplate;
  try {
    t = JSON.parse(json ?? '');
  } catch {
    return { error: 'The sign-in request is unreadable.' };
  }
  if (!t || t.kind !== KIND_HTTP_AUTH || !Array.isArray(t.tags) || t.content !== '') return { error: 'This is not a sign-in request.' };
  const tag = (n: string) => t.tags.filter((x) => Array.isArray(x) && x[0] === n);
  const u = tag('u');
  if (u.length !== 1) return { error: 'The sign-in request has no single URL.' };
  try {
    if (new URL(String(u[0]![1])).origin !== returnUrl.origin)
      return { error: `The request is for ${new URL(String(u[0]![1])).origin}, but would be sent to ${returnUrl.origin}.` };
  } catch {
    return { error: 'The sign-in request URL is invalid.' };
  }
  if (tag('method')[0]?.[1] !== 'POST') return { error: 'Only POST sign-in requests are signed.' };
  if (!isLowerHex(tag('payload')[0]?.[1], 32)) return { error: 'The sign-in request does not commit to its body.' };
  const app = (q.get('app') ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || returnUrl.host;
  return { app, returnUrl: returnUrl.toString(), origin: returnUrl.origin, template: { kind: t.kind, created_at: t.created_at, tags: t.tags, content: '' } };
};

export const SignRequest = () => {
  const { nostr, restoring, disconnectNostr, startSandbox } = useSession();
  const [, navigate] = useLocation();
  const request = useMemo(parseRequest, []);
  const [phase, setPhase] = useState<'approve' | 'signing' | 'done'>('approve');
  const [error, setError] = useState<string>();
  const lookup = useLookup(nostr ? npubEncode(nostr.pubkey) : undefined);
  usePageTitle('error' in request ? 'Sign in' : `Sign in to ${request.app}`);

  const back = useCallback(
    (fragment: string) => {
      if ('error' in request) return;
      location.replace(`${request.returnUrl.split('#')[0]}#${fragment}`);
    },
    [request],
  );

  const approve = useCallback(async () => {
    if ('error' in request || !nostr || phase !== 'approve') return;
    setPhase('signing');
    setError(undefined);
    try {
      // Only the timestamp is refreshed, so a slow approval does not fall outside the app's window.
      const event = await nostr.signer.signEvent({ ...request.template, created_at: nowSeconds() });
      setPhase('done');
      const delay = prefersReducedMotion() ? 0 : 340;
      setTimeout(() => back(`cachet=${toBase64Url(JSON.stringify(event))}`), delay);
    } catch (e) {
      setPhase('approve');
      setError(e instanceof Error ? e.message : 'Signing failed');
    }
  }, [request, nostr, phase, back]);

  const result = lookup.state.status === 'done' ? lookup.state.result : undefined;
  const isActiveLink = result?.resolution.state === 'active';

  useEffect(() => {
    if ('error' in request || !nostr || phase !== 'approve' || !isActiveLink) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void approve();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, nostr, phase, isActiveLink, approve]);

  if ('error' in request) {
    return (
      <div className="signer">
        <div className="c-card signer__card">
          <div className="signer__brand">
            <Logo size={20} /> cachet
          </div>
          <h1>{request.error === 'missing' ? 'Sign-in page' : 'Cannot sign this request'}</h1>
          <p className="soft" style={{ margin: 0 }}>
            {request.error === 'missing' ? 'Apps send you here when you choose “Sign in with Cachet”. It signs one login request for that app.' : request.error}
          </p>
          <Link href="/" className="c-btn c-btn--secondary">
            Go to Cachet
          </Link>
        </div>
      </div>
    );
  }

  const claim = result?.resolution.primary;
  const accent = knownApp(request.origin)?.accent;

  const quickMintSandbox = () => {
    savePendingSign({ app: request.app, search: location.search });
    startSandbox();
    navigate('/new?sandbox=1');
  };

  return (
    <div className="signer">
      <div className="c-card signer__card" data-phase={phase}>
        <div className="signer__bridge" aria-hidden>
          <span className="signer__node signer__node--cachet">
            <Logo size={20} />
          </span>
          <span className="signer__beam" data-phase={phase}>
            <span className="signer__beam-tag mono">NIP-98</span>
          </span>
          <span className="signer__node signer__node--app" style={accent ? { background: accent, color: '#fff', borderColor: accent } : undefined}>
            {request.app.slice(0, 1).toUpperCase()}
          </span>
        </div>

        <div className="signer__origin">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{request.app}</div>
            <div className="mono muted" style={{ fontSize: 12.5 }}>
              {request.origin}
            </div>
          </div>
          <span className="c-tag" style={{ marginLeft: 'auto' }}>
            One-time login
          </span>
        </div>

        <h1>{phase === 'done' ? `Signed in to ${request.app}` : `Sign in to ${request.app}?`}</h1>

        {restoring ? (
          <div className="row muted">
            <Spinner /> Loading your key…
          </div>
        ) : !nostr ? (
          <>
            <p className="soft" style={{ margin: 0, fontSize: 14 }}>
              Choose the Nostr key to sign in with, or try it with sandbox keys.
            </p>
            <NostrConnect />
            <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={quickMintSandbox}>
              <IconZap size={14} /> Make a sandbox link and continue
            </button>
          </>
        ) : (
          <>
            <div className="signer__who">
              <Avatar pubkey={nostr.pubkey} picture={result?.profile?.picture} size={36} />
              <div className="signer__who-text">
                <div className="signer__name">{result?.profile?.displayName || result?.profile?.name || shortNpub(nostr.pubkey)}</div>
                <div className="mono muted signer__addr">{claim ? shortCashaddr(claim.cashaddr) : shortNpub(nostr.pubkey)}</div>
              </div>
              <StatePill state={result ? result.resolution.state : 'loading'} />
            </div>
            {phase === 'approve' && (
              <button type="button" className="c-link signer__switch" onClick={disconnectNostr}>
                Use a different key
              </button>
            )}
            {result && result.resolution.state !== 'active' && (
              <Note tone="warn">
                {request.app} will refuse this key: it has no active BCH link.{' '}
                {nostr.signer.type === 'local' ? (
                  <button type="button" className="c-link" onClick={quickMintSandbox}>
                    Make a sandbox link <IconArrowRight size={12} />
                  </button>
                ) : (
                  <Link href="/new" onClick={() => savePendingSign({ app: request.app, search: location.search })}>
                    Create one first
                  </Link>
                )}
              </Note>
            )}
            <p className="muted signer__fine">
              {request.app} receives your npub and one signed login request, valid only at {new URL(request.origin).host}. It checks your BCH link on
              the relays itself.
            </p>
            {error && <Note tone="danger">{error}</Note>}
            {phase === 'done' ? (
              <div className="signed-line">
                <IconCheck /> Signed. Returning to {request.app}…
              </div>
            ) : (
              <div className="signer__actions">
                <button type="button" className="c-btn c-btn--accent c-btn--lg" onClick={() => void approve()} disabled={phase === 'signing'}>
                  {phase === 'signing' && <Spinner />} {phase === 'signing' ? 'Signing…' : 'Approve & sign in'}
                </button>
                <button type="button" className="c-btn c-btn--lg c-btn--ghost" onClick={() => back('cachet-error=cancelled')} disabled={phase === 'signing'}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
