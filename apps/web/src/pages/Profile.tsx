import { useState } from 'react';
import { Link } from 'wouter';
import { STATE_LABELS, isAddressError, normalizeCashAddrInput, nowSeconds, type BindingDetails, type BindingState, type ClaimStatus } from '@cachet/core';
import { isPublicRelayUrl, uniqueRelays, type LookupResult } from '@cachet/discovery';
import {
  CheckList,
  CopyChip,
  CopyIcon,
  Dialog,
  IconDownload,
  IconRefresh,
  IdentityCard,
  Note,
  RelayList,
  Spinner,
  StatePill,
  formatDate,
  formatDateTime,
  relativeTime,
  relayRowsFromLookup,
  shortCashaddr,
  shortMiddle,
  shortNpub,
} from '@cachet/react';
import { config } from '../config.ts';
import { useLookup } from '../lib/useLookup.ts';
import { useSession } from '../lib/session.tsx';
import { withdrawBinding } from '../lib/publish.ts';
import { downloadJson } from '../lib/download.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';
import { PayPanel } from '../components/PayPanel.tsx';
import { ShareButton } from '../components/ShareButton.tsx';

const NOT_PAYABLE: Partial<Record<BindingState, string>> = {
  withdrawn: 'The owner removed this address from their profile. Do not pay it on the strength of this identity.',
  expired: 'This link has expired. Ask the owner to renew it before paying.',
  invalid: 'The published proof does not verify. Do not pay this address based on this identity.',
};

const RENEW_WINDOW = 7 * 86400;

const Evidence = ({ result, claim, onRefresh, refreshing }: { result: LookupResult; claim?: ClaimStatus; onRefresh: () => void; refreshing: boolean }) => {
  const [raw, setRaw] = useState(false);
  const latest = result.resolution.latest;
  const rows = relayRowsFromLookup(result.relays, result.resolution);
  const json = latest ? JSON.stringify(latest, null, 2) : '';
  return (
    <div className="c-card panel" aria-busy={refreshing}>
      <div className="panel__head">
        <h2>Verification</h2>
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <Spinner /> : <IconRefresh size={14} />} {refreshing ? 'Checking…' : 'Re-check'}
        </button>
      </div>
      <div className="panel__body" data-dim={refreshing || undefined}>
        {claim?.result ? (
          <CheckList key={`${latest?.id}-${result.resolution.observedAt}`} checks={claim.result.checks} />
        ) : claim?.state === 'withdrawn' ? (
          <Note>
            Snapshot <span className="mono">{shortMiddle(claim.eventId, 8, 4)}</span> had this address; the newer snapshot{' '}
            <span className="mono">{shortMiddle(claim.withdrawnBy ?? '', 8, 4)}</span> removed it.
          </Note>
        ) : (
          <Note>No BCH claim in the latest snapshot.</Note>
        )}

        <h3 className="c-section-title panel__sub">Relays</h3>
        <RelayList rows={rows} />
        {result.usedCache && (
          <p className="muted panel__fine">
            {result.resolution.state !== 'unavailable'
              ? 'This browser had seen a newer snapshot than the relays returned, so it kept that one.'
              : 'Showing the last snapshot cached in this browser; relays did not answer.'}
          </p>
        )}

        {latest && (
          <>
            <h3 className="c-section-title panel__sub">Snapshot</h3>
            <dl className="kv">
              <dt>Event</dt>
              <dd title={latest.id}>{shortMiddle(latest.id, 14, 8)}</dd>
              <dt>Published</dt>
              <dd>{formatDateTime(latest.created_at)}</dd>
              {claim?.result?.binding && (
                <>
                  <dt>Binding</dt>
                  <dd title={claim.result.binding.bindingId}>{shortMiddle(claim.result.binding.bindingId, 14, 8)}</dd>
                </>
              )}
              <dt>Checked</dt>
              <dd>{formatDateTime(result.resolution.observedAt)}</dd>
              {result.relayList.source === 'nip65' && (
                <>
                  <dt>Write relays</dt>
                  <dd>{result.relayList.write.length} from NIP-65</dd>
                </>
              )}
            </dl>
            <div className="row panel__actions">
              <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => downloadJson(`cachet-${shortNpub(result.pubkey)}.json`, latest)}>
                <IconDownload size={14} /> Download proof
              </button>
              <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setRaw(!raw)} aria-expanded={raw}>
                {raw ? 'Hide event' : 'Raw event'}
              </button>
            </div>
            <p className="muted panel__fine">
              Verify offline: <span className="mono">npm run verify -- proof.json</span>
            </p>
            {raw && (
              <div className="message-box raw-event">
                <pre className="c-code">{json}</pre>
                <CopyIcon value={json} title="Copy event JSON" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const OwnerBar = ({
  result,
  claim,
  binding,
  onChanged,
}: {
  result: LookupResult;
  claim?: ClaimStatus;
  binding?: BindingDetails;
  onChanged: () => void;
}) => {
  const { nostr } = useSession();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!nostr || nostr.pubkey !== result.pubkey) return null;
  const state = result.resolution.state;
  const left = binding ? binding.expiresAt - nowSeconds() : undefined;
  const expiringSoon = state === 'active' && left !== undefined && left < RENEW_WINDOW;
  const needsRenewal = state === 'expired' || expiringSoon;

  const withdraw = async () => {
    if (!claim) return;
    setBusy(true);
    setError(undefined);
    try {
      const allowPrivate = config.relays.some((u) => !isPublicRelayUrl(u));
      const writeRelays = result.relayList.write.filter((u) => allowPrivate || isPublicRelayUrl(u)).slice(0, 3);
      const out = await withdrawBinding({ nostr, cashaddr: claim.cashaddr, relays: uniqueRelays(config.relays, writeRelays) });
      if (!out.results.some((r) => r.ok)) throw new Error('No relay accepted the update.');
      setConfirm(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="owner-bar" data-tone={needsRenewal ? 'warn' : undefined}>
      <span>
        Your identity
        {expiringSoon && binding && <span className="owner-bar__hint"> · expires {relativeTime(binding.expiresAt)}</span>}
        {state === 'expired' && <span className="owner-bar__hint"> · this link has expired</span>}
      </span>
      <span className="row owner-bar__actions">
        <Link className={needsRenewal ? 'c-btn c-btn--sm' : 'c-btn c-btn--secondary c-btn--sm'} href="/new">
          {needsRenewal ? 'Renew' : claim && claim.state !== 'withdrawn' ? 'Renew or add address' : 'Link an address'}
        </Link>
        {claim && claim.state !== 'withdrawn' && (
          <button type="button" className="c-btn c-btn--danger c-btn--sm" onClick={() => (setError(undefined), setConfirm(true))}>
            Withdraw
          </button>
        )}
      </span>
      <Dialog open={confirm} onClose={() => !busy && setConfirm(false)} title="Withdraw this link?">
        <div style={{ display: 'grid', gap: 16 }}>
          <p className="soft" style={{ margin: 0 }}>
            Publishes a new snapshot without <span className="mono">{shortCashaddr(claim?.cashaddr ?? '')}</span>. Apps that check relays will stop
            accepting it. Copies of the old proof still exist, but they are no longer your current profile.
          </p>
          {error && <Note tone="danger">{error}</Note>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="c-btn c-btn--ghost" onClick={() => setConfirm(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="c-btn c-btn--danger-solid" onClick={withdraw} disabled={busy}>
              {busy && <Spinner />} {busy ? 'Publishing…' : 'Withdraw and publish'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

const LoadingPanels = ({ state }: { state: Extract<ReturnType<typeof useLookup>['state'], { status: 'loading' }> }) => (
  <div className="c-card panel">
    <div className="panel__head">
      <h2>Asking relays</h2>
      <Spinner />
    </div>
    <RelayList rows={relayRowsFromLookup(state.relays, undefined, state.pending)} />
  </div>
);

export const Profile = ({ id }: { id: string }) => {
  const { state, refresh, refreshing } = useLookup(id);
  const { nostr } = useSession();
  const query = new URLSearchParams(window.location.search);
  const requestedAmount = query.get('amount') ?? undefined;
  const rawExpected = query.get('address') ?? undefined;
  const parsedExpected = rawExpected ? normalizeCashAddrInput(rawExpected) : undefined;
  const expectedAddress = rawExpected ? (parsedExpected && !isAddressError(parsedExpected) ? parsedExpected.address : rawExpected) : undefined;

  const result = state.status === 'done' ? state.result : undefined;
  const name = result?.profile?.displayName || result?.profile?.name || (result ? shortNpub(result.pubkey) : '');
  usePageTitle(state.status === 'error' ? 'Not found' : result ? name : undefined);

  if (state.status === 'error') {
    return (
      <div className="wrap page">
        <div className="empty">
          <h2>Nothing to show</h2>
          <p>{state.message}</p>
          <Link className="c-btn c-btn--secondary" href="/">
            Back
          </Link>
        </div>
      </div>
    );
  }

  const others = state.status === 'done' ? state.others : [];
  const resolution = result?.resolution;
  const claim = resolution?.primary;
  const binding = claim?.result?.binding;
  const legacy = result?.legacy;
  const cardState = state.status !== 'done' ? 'loading' : resolution!.state;
  const isMe = !!result && nostr?.pubkey === result.pubkey;
  const extraClaims = resolution?.claims.filter((c) => c !== claim) ?? [];
  const profileUrl = result ? `${window.location.origin}/p/${result.npub}` : '';

  return (
    <div className="wrap page">
      <div className="profile">
        {result && <OwnerBar result={result} claim={claim} binding={binding} onChanged={refresh} />}
        <IdentityCard
          state={cardState}
          pubkey={result?.pubkey ?? (state.status === 'loading' ? state.pubkey : undefined)}
          name={result?.profile?.displayName || result?.profile?.name}
          picture={result?.profile?.picture}
          cashaddr={claim?.cashaddr}
          tokenAware={binding?.tokenAware}
          expiresAt={binding?.expiresAt}
          emptyBch={
            resolution?.state === 'not_found'
              ? legacy
                ? 'Unverified 30078 announcement'
                : 'No BCH address linked'
              : resolution?.state === 'unavailable'
                ? 'Relays unavailable'
                : undefined
          }
          foot={
            result ? (
              <>
                <StatePill state={resolution!.state} label={legacy && resolution!.state === 'not_found' ? 'Announced · unverified' : undefined} />
                {binding && resolution!.state === 'active' && <span>Valid until {formatDate(binding.expiresAt)}</span>}
                {binding && resolution!.state === 'expired' && <span>Expired {formatDate(binding.expiresAt)}</span>}
                {resolution!.state === 'unavailable' && resolution!.latest && <span>Cached snapshot · relays offline</span>}
                {binding && binding.network !== 'mainnet' && <span>{binding.network}</span>}
                {claim?.state === 'withdrawn' && <span>Removed in a newer snapshot</span>}
                {resolution!.otherIdentities.length > 0 && <span className="hide-sm">Also: {resolution!.otherIdentities.slice(0, 3).join(', ')}</span>}
                <span className="c-idcard__foot-end">
                  <ShareButton url={profileUrl} title={`${name} on Cachet`} />
                </span>
              </>
            ) : undefined
          }
        />

        {others.length > 0 && (
          <Note>
            {others.length + 1} identities claim this address. Showing the first active one. Others:{' '}
            {others.map((o, i) => (
              <span key={o.pubkey}>
                {i > 0 && ', '}
                <Link href={`/p/${o.npub}`}>{shortNpub(o.pubkey)}</Link> ({STATE_LABELS[o.resolution.state]})
              </span>
            ))}
          </Note>
        )}

        {state.status === 'loading' ? (
          <LoadingPanels state={state} />
        ) : result && resolution!.state === 'not_found' ? (
          <div className="c-card empty">
            <h2>{legacy ? 'Announced address, not verified' : 'No BCH link yet'}</h2>
            {legacy ? (
              <div className="legacy">
                <Note tone="warn">
                  <strong>Paytaca kind 30078 announcement.</strong> This Nostr key published{' '}
                  <span className="mono">{shortCashaddr(legacy.cashaddr)}</span> without a BCH wallet signature proving control of it. Verified checkout and
                  app sign-in stay off until both keys sign a NIP-39 link.
                </Note>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <CopyChip value={legacy.cashaddr} label={`Unverified: ${shortCashaddr(legacy.cashaddr)}`} />
                  {isMe && (
                    <Link className="c-btn c-btn--sm" href="/new">
                      Upgrade to a verified link
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <>
                <p>
                  {isMe
                    ? 'Link a BCH address to this npub so people can pay you and apps can sign you in.'
                    : 'This npub has not published a BCH link on the relays checked.'}
                </p>
                {isMe && (
                  <Link className="c-btn" href="/new">
                    Link an address
                  </Link>
                )}
              </>
            )}
            <div className="empty__relays">
              <RelayList rows={relayRowsFromLookup(result.relays, resolution)} />
            </div>
          </div>
        ) : result ? (
          <div className="profile__grid">
            <div className="c-card panel">
              <div className="panel__head">
                <h2>Pay {name}</h2>
              </div>
              {resolution!.state === 'active' && claim ? (
                binding?.network && binding.network !== 'mainnet' ? (
                  <Note tone="warn">
                    This link points to a <strong>{binding.network}</strong> test address (<span className="mono">{shortCashaddr(claim.cashaddr)}</span>).
                    Mainnet payment is disabled so real BCH cannot be sent to a test key.
                  </Note>
                ) : expectedAddress && claim.cashaddr !== expectedAddress ? (
                  <Note tone="danger">
                    This identity now resolves to <span className="mono">{shortCashaddr(claim.cashaddr)}</span> instead of the checkout address{' '}
                    <span className="mono">{shortCashaddr(expectedAddress)}</span>. Payment is blocked.
                  </Note>
                ) : (
                  <PayPanel cashaddr={claim.cashaddr} payee={name} {...(requestedAmount ? { initialAmount: requestedAmount } : {})} />
                )
              ) : (
                <Note tone={resolution!.state === 'unavailable' ? 'warn' : 'danger'}>
                  {NOT_PAYABLE[resolution!.state] ?? 'Relays did not answer, so this identity could not be checked. Try again shortly.'}
                </Note>
              )}
              {extraClaims.length > 0 && (
                <div className="claims-more">
                  <h3 className="c-section-title">Other addresses in this profile</h3>
                  {extraClaims.map((c) => (
                    <div key={c.cashaddr} className="claim-row">
                      <span className="mono">{shortCashaddr(c.cashaddr, 10, 8)}</span>
                      <StatePill state={c.state} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Evidence result={result} claim={claim} onRefresh={refresh} refreshing={refreshing} />
          </div>
        ) : null}
        {result && !isMe && resolution!.state === 'active' && (
          <p className="muted profile__fine">
            Checked by this page against {result.relays.filter((r) => r.status === 'ok').length} relays. Nothing here came from a Cachet server.
          </p>
        )}
      </div>
    </div>
  );
};
