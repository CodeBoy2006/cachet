import type { ReactNode } from 'react';
import { npubEncode, type BindingState } from '@cachet/core';
import { IconCheck, IconClock, IconX } from './icons.tsx';
import { Avatar, CopyIcon, Logo, Spinner, StatePill } from './ui.tsx';
import { formatDate, shortMiddle } from './format.ts';

export interface IdentityCardProps {
  pubkey?: string;
  name?: string;
  picture?: string;
  cashaddr?: string;
  tokenAware?: boolean;
  state: BindingState | 'loading' | 'draft';
  expiresAt?: number;
  foot?: ReactNode;
  /** Placeholder text for empty halves in draft mode. */
  emptyNostr?: string;
  emptyBch?: string;
}

/** Two truncations; a container query on the card shows the one that fits. */
const Fit = ({ value, long, short }: { value: string; long: [number, number]; short: [number, number] }) => (
  <>
    <span className="fit-long">{shortMiddle(value, ...long)}</span>
    <span className="fit-short">{shortMiddle(value, ...short)}</span>
  </>
);

const Seal = ({ state }: { state: IdentityCardProps['state'] }) => {
  if (state === 'active') return <IconCheck size={18} strokeWidth={2} />;
  if (state === 'invalid') return <IconX size={18} strokeWidth={2} />;
  if (state === 'expired' || state === 'unavailable') return <IconClock size={18} />;
  if (state === 'loading') return <Spinner />;
  return <Logo size={20} verified={false} />;
};

/** The two halves of one identity: the Nostr key and the BCH address it proves. */
export const IdentityCard = ({ pubkey, name, picture, cashaddr, tokenAware, state, expiresAt, foot, emptyNostr, emptyBch }: IdentityCardProps) => {
  const npub = pubkey ? npubEncode(pubkey) : undefined;
  const body = cashaddr?.split(':')[1];
  return (
    <article className="c-idcard" data-state={state} aria-label="Identity">
      <div className="c-idcard__halves">
        <div className="c-idcard__half">
          <div className="c-idcard__kicker">
            <span className="c-dot" style={{ background: 'var(--dot-nostr)' }} />
            Nostr
          </div>
          {npub ? (
            <div className="c-idcard__who">
              <Avatar pubkey={pubkey} picture={picture} />
              <div style={{ minWidth: 0 }}>
                {name ? (
                  <>
                    <div className="c-idcard__name">{name}</div>
                    <div className="c-idcard__value">
                      <Fit value={npub} long={[10, 6]} short={[8, 4]} />
                      <CopyIcon value={npub} title="Copy npub" />
                    </div>
                  </>
                ) : (
                  <div className="c-idcard__value c-idcard__value--solo">
                    <Fit value={npub} long={[10, 6]} short={[8, 4]} />
                    <CopyIcon value={npub} title="Copy npub" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="c-idcard__who">
              <span className="c-avatar" style={{ borderStyle: 'dashed' }} />
              <span className="muted" style={{ fontSize: 14 }}>
                {state === 'loading' ? <span className="c-skel" style={{ width: 140 }} /> : emptyNostr ?? 'No key yet'}
              </span>
            </div>
          )}
        </div>
        <div className="c-idcard__seal">
          <Seal state={state} />
        </div>
        <div className="c-idcard__half c-idcard__half--bch">
          <div className="c-idcard__kicker">
            <span className="c-dot" style={{ background: 'var(--dot-bch)' }} />
            Bitcoin Cash
            {tokenAware && <span className="c-tag">CashTokens</span>}
          </div>
          {body ? (
            <>
              <div className="c-idcard__addr" title={cashaddr}>
                <Fit value={body} long={[10, 8]} short={[7, 6]} />
              </div>
              <div className="c-idcard__value">
                <span>{cashaddr!.split(':')[0]}</span>
                <CopyIcon value={cashaddr!} title="Copy address" />
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 14, paddingTop: 10 }}>
              {state === 'loading' ? <span className="c-skel" style={{ width: 180 }} /> : emptyBch ?? 'No address yet'}
            </div>
          )}
        </div>
      </div>
      <div className="c-idcard__foot">
        {foot ?? (
          <>
            {state !== 'draft' && <StatePill state={state} />}
            {expiresAt && state === 'active' && <span>Valid until {formatDate(expiresAt)}</span>}
            {expiresAt && state === 'expired' && <span>Expired {formatDate(expiresAt)}</span>}
          </>
        )}
      </div>
    </article>
  );
};
