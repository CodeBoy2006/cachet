import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { KIND_HTTP_AUTH, fromBase64Url, isLowerHex, npubEncode, nowSeconds, toBase64Url, type EventTemplate } from '@cachet/core';
import { Avatar, IconCheck, Logo, Note, Spinner, StatePill, shortCashaddr, shortNpub } from '@cachet/react';
import { useSession } from '../lib/session.tsx';
import { savePendingSign } from '../lib/storage.ts';
import { useLookup } from '../lib/useLookup.ts';
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
    // The signature must only be usable at the app that receives it.
    if (new URL(String(u[0]![1])).origin !== returnUrl.origin) return { error: `The request is for ${new URL(String(u[0]![1])).origin}, but would be sent to ${returnUrl.origin}.` };
  } catch {
    return { error: 'The sign-in request URL is invalid.' };
  }
  if (tag('method')[0]?.[1] !== 'POST') return { error: 'Only POST sign-in requests are signed.' };
  if (!isLowerHex(tag('payload')[0]?.[1], 32)) return { error: 'The sign-in request does not commit to its body.' };
  const app = (q.get('app') ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || returnUrl.host;
  return { app, returnUrl: returnUrl.toString(), origin: returnUrl.origin, template: { kind: t.kind, created_at: t.created_at, tags: t.tags, content: '' } };
};

export const SignRequest = () => {
  const { nostr, restoring } = useSession();
  const request = useMemo(parseRequest, []);
  const [phase, setPhase] = useState<'approve' | 'signing' | 'done'>('approve');
  const [error, setError] = useState<string>();
  const lookup = useLookup(nostr ? npubEncode(nostr.pubkey) : undefined);

  if ('error' in request) {
    return (
      <div className="signer">
        <div className="c-card signer__card">
          <div className="row" style={{ gap: 8, fontWeight: 600 }}>
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

  const back = (fragment: string) => location.replace(`${request.returnUrl.split('#')[0]}#${fragment}`);

  const approve = async () => {
    if (!nostr) return;
    setPhase('signing');
    setError(undefined);
    try {
      // Only the timestamp is refreshed, so a slow approval does not fall outside the app's window.
      const event = await nostr.signer.signEvent({ ...request.template, created_at: nowSeconds() });
      setPhase('done');
      back(`cachet=${toBase64Url(JSON.stringify(event))}`);
    } catch (e) {
      setPhase('approve');
      setError(e instanceof Error ? e.message : 'Signing failed');
    }
  };

  const result = lookup.state.status === 'done' ? lookup.state.result : undefined;
  const claim = result?.resolution.primary;

  return (
    <div className="signer">
      <div className="c-card signer__card">
        <div className="row" style={{ gap: 8, fontWeight: 600 }}>
          <Logo size={20} /> cachet
        </div>
        <div className="signer__origin">
          <span className="favicon" style={{ background: 'var(--ink)' }}>
            {request.app.slice(0, 1).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{request.app}</div>
            <div className="mono muted" style={{ fontSize: 12.5 }}>
              {request.origin}
            </div>
          </div>
        </div>
        <h1>{phase === 'done' ? 'Signed. Returning…' : `Sign in to ${request.app}?`}</h1>

        {restoring ? (
          <div className="row muted">
            <Spinner /> Loading your key…
          </div>
        ) : !nostr ? (
          <>
            <p className="soft" style={{ margin: 0, fontSize: 14 }}>
              Choose the Nostr key to sign in with.
            </p>
            <NostrConnect />
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 12 }}>
              <Avatar pubkey={nostr.pubkey} picture={result?.profile?.picture} size={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 550 }}>{result?.profile?.displayName || result?.profile?.name || shortNpub(nostr.pubkey)}</div>
                <div className="mono muted" style={{ fontSize: 12.5 }}>
                  {claim ? shortCashaddr(claim.cashaddr) : shortNpub(nostr.pubkey)}
                </div>
              </div>
              <StatePill state={result ? result.resolution.state : 'loading'} />
            </div>
            {result && result.resolution.state !== 'active' && (
              <Note tone="warn">
                {request.app} will refuse this key: it has no active BCH link.{' '}
                <Link href="/new" onClick={() => savePendingSign({ app: request.app, search: location.search })}>
                  Create one
                </Link>{' '}
                first.
              </Note>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {request.app} receives your npub and one signed login request valid only at {new URL(request.origin).host}. It checks your BCH link on
              the relays itself.
            </p>
            {error && <Note tone="danger">{error}</Note>}
            {phase === 'done' ? (
              <div className="signed-line">
                <IconCheck /> Login request signed.
              </div>
            ) : (
              <div className="row">
                <button type="button" className="c-btn c-btn--lg" style={{ flex: 1 }} onClick={approve} disabled={phase === 'signing'}>
                  {phase === 'signing' && <Spinner />} Sign in
                </button>
                <button type="button" className="c-btn c-btn--lg c-btn--ghost" onClick={() => back('cachet-error=cancelled')}>
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
