import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { npubEncode, type BindingState } from '@cachet/core';
import { IconCheck, IconClock, IconX } from './icons.tsx';
import { Avatar, CopyIcon, Spinner, StatePill } from './ui.tsx';
import { formatDate, shortMiddle } from './format.ts';

export interface IdentityCardProps {
  pubkey?: string;
  name?: string;
  picture?: string;
  cashaddr?: string;
  tokenAware?: boolean;
  state: BindingState | 'loading' | 'draft';
  /** In draft mode, lights up and magnetically pulls the BCH ring before final Nostr publish. */
  bchSigned?: boolean;
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

const DualRings = ({
  hasNostr,
  hasBch,
  bchSigned,
  withdrawn,
}: {
  hasNostr: boolean;
  hasBch: boolean;
  bchSigned?: boolean;
  withdrawn: boolean;
}) => {
  const pull = bchSigned ? 1.45 : withdrawn ? -1.1 : hasNostr && hasBch ? 0.55 : 0;
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden className="c-seal-rings">
      {bchSigned && (
        <path
          d="M12 6.234A6.5 6.5 0 0 1 12 17.766A6.5 6.5 0 0 1 12 6.234Z"
          fill="color-mix(in srgb, var(--accent) 26%, transparent)"
        />
      )}
      <circle
        className="c-seal-ring"
        cx={9}
        cy={12}
        r={6.2}
        stroke={hasNostr && !withdrawn ? 'var(--dot-nostr)' : 'currentColor'}
        strokeWidth={1.65}
        strokeDasharray={hasNostr && !withdrawn ? undefined : '2.2 2.1'}
        style={{ transform: `translateX(${pull}px)` }}
      />
      <circle
        className="c-seal-ring"
        cx={15}
        cy={12}
        r={6.2}
        stroke={hasBch && !withdrawn ? 'var(--dot-bch)' : 'currentColor'}
        strokeWidth={1.65}
        strokeDasharray={bchSigned ? undefined : '2.2 2.1'}
        style={{ transform: `translateX(${-pull}px)` }}
      />
    </svg>
  );
};

const Seal = ({
  state,
  hasNostr,
  hasBch,
  bchSigned,
}: {
  state: IdentityCardProps['state'];
  hasNostr: boolean;
  hasBch: boolean;
  bchSigned?: boolean;
}) => {
  if (state === 'active') return <IconCheck size={18} strokeWidth={2.2} />;
  if (state === 'invalid') return <IconX size={17} strokeWidth={2.2} />;
  if (state === 'expired' || state === 'unavailable') return <IconClock size={18} />;
  if (state === 'loading') return <Spinner />;
  return <DualRings hasNostr={hasNostr} hasBch={hasBch} bchSigned={bchSigned} withdrawn={state === 'withdrawn'} />;
};

/** The two halves of one identity: the Nostr key and the BCH address it proves. */
export const IdentityCard = ({
  pubkey,
  name,
  picture,
  cashaddr,
  tokenAware,
  state,
  bchSigned,
  expiresAt,
  foot,
  emptyNostr,
  emptyBch,
}: IdentityCardProps) => {
  const npub = pubkey ? npubEncode(pubkey) : undefined;
  const body = cashaddr?.split(':')[1];
  const cardRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = cardRef.current;
    if (!el) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
      const y = Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
      el.dataset.tilting = 'true';
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      el.style.setProperty('--rx', `${((0.5 - y) * 4.8).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${((x - 0.5) * 5.6).toFixed(2)}deg`);
    });
  };

  const onPointerLeave = () => {
    cancelAnimationFrame(frameRef.current);
    const el = cardRef.current;
    if (!el) return;
    delete el.dataset.tilting;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <article
      ref={cardRef}
      className="c-idcard"
      data-state={state}
      data-nostr={Boolean(npub) || undefined}
      data-bch-signed={bchSigned || undefined}
      aria-label="Identity"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span className="c-idcard__foil" aria-hidden />
      <span className="c-idcard__sweep" aria-hidden />
      <div className="c-idcard__halves">
        <div className="c-idcard__half">
          <div className="c-idcard__kicker">
            <span className="c-dot c-dot--nostr" style={{ background: 'var(--dot-nostr)' }} />
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
          <Seal state={state} hasNostr={Boolean(npub)} hasBch={Boolean(body)} bchSigned={bchSigned} />
        </div>
        <div className="c-idcard__half c-idcard__half--bch">
          <div className="c-idcard__kicker">
            <span className="c-dot c-dot--bch" style={{ background: 'var(--dot-bch)' }} />
            Bitcoin Cash
            {tokenAware && <span className="c-tag">CashTokens</span>}
          </div>
          {body ? (
            <>
              <div className="c-idcard__addr" title={cashaddr}>
                <span className="c-idcard__addr-text">
                  <Fit value={body} long={[10, 8]} short={[7, 6]} />
                </span>
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
