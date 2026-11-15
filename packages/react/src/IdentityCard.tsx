import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { npubEncode, type BindingState } from '@cachet/core';
import { IconClock } from './icons.tsx';
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

/**
 * Continuous geometric state machine for the two cryptographic halves:
 * - Draft: two rings slightly apart, lighting up violet (Nostr) and emerald (BCH) as keys arrive.
 * - BCH signed: strong magnetic pull, illuminating the shared vesica-piscis lens.
 * - Active (sealed): both rings converge concentrically into an engraved inner rim around the check.
 * - Withdrawn / not_found: the rings decouple completely with a visible gap between them.
 * - Invalid: fractured rings behind a crisp two-stroke rejection mark.
 */
const SealEmblem = ({
  state,
  hasNostr,
  hasBch,
  bchSigned,
}: {
  state: 'draft' | 'active' | 'withdrawn' | 'invalid' | 'not_found';
  hasNostr: boolean;
  hasBch: boolean;
  bchSigned?: boolean;
}) => {
  const active = state === 'active';
  const invalid = state === 'invalid';
  const decoupled = state === 'withdrawn' || state === 'not_found';
  const shift = active
    ? 3.5
    : invalid
      ? -1.6
      : decoupled
        ? -3.1
        : bchSigned
          ? 1.95
          : hasNostr && hasBch
            ? 0.65
            : hasNostr || hasBch
              ? 0
              : -0.9;
  const ringScale = active ? 1.54 : invalid ? 0.92 : 1;
  const leftStroke =
    active || invalid
      ? 'color-mix(in srgb, currentColor 30%, transparent)'
      : hasNostr && !decoupled
        ? 'var(--dot-nostr)'
        : 'currentColor';
  const rightStroke =
    active || invalid
      ? 'color-mix(in srgb, currentColor 30%, transparent)'
      : hasBch && !decoupled
        ? 'var(--dot-bch)'
        : 'currentColor';
  const solidLeft = active || invalid || (hasNostr && !decoupled);
  const solidRight = active || invalid || Boolean(bchSigned);

  return (
    <svg width={26} height={26} viewBox="0 0 26 26" fill="none" aria-hidden className="c-seal-svg">
      {bchSigned && !active && !invalid && !decoupled && (
        <path
          className="c-seal-lens"
          d="M13 7.6A6.1 6.1 0 0 1 13 18.4A6.1 6.1 0 0 1 13 7.6Z"
          fill="color-mix(in srgb, var(--accent) 30%, transparent)"
        />
      )}
      <circle
        className="c-seal-ring c-seal-ring--l"
        cx={9.5}
        cy={13}
        r={5.8}
        stroke={leftStroke}
        strokeWidth={active || invalid ? 1.1 : 1.65}
        strokeDasharray={solidLeft ? undefined : '2.2 2.1'}
        style={{ transform: `translateX(${shift}px) scale(${ringScale})`, transformOrigin: '9.5px 13px' }}
      />
      <circle
        className="c-seal-ring c-seal-ring--r"
        cx={16.5}
        cy={13}
        r={5.8}
        stroke={rightStroke}
        strokeWidth={active || invalid ? 1.1 : 1.65}
        strokeDasharray={solidRight ? undefined : '2.2 2.1'}
        style={{ transform: `translateX(${-shift}px) scale(${ringScale})`, transformOrigin: '16.5px 13px' }}
      />
      {active && (
        <path
          className="c-stroke-draw"
          pathLength={1}
          d="M8.5 13.3 11.4 16.2 17.6 9.8"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {invalid && (
        <>
          <path
            className="c-stroke-draw"
            pathLength={1}
            d="M9.5 9.5l7 7"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <path
            className="c-stroke-draw c-stroke-draw--2"
            pathLength={1}
            d="M16.5 9.5l-7 7"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </>
      )}
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
  if (state === 'expired' || state === 'unavailable') return <IconClock size={18} />;
  if (state === 'loading') return <Spinner />;
  return <SealEmblem state={state} hasNostr={hasNostr} hasBch={hasBch} bchSigned={bchSigned} />;
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
      el.style.setProperty('--rx', `${((0.5 - y) * 4.4).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${((x - 0.5) * 5.2).toFixed(2)}deg`);
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
      data-bch={Boolean(body) || undefined}
      data-bch-signed={bchSigned || undefined}
      aria-label="Identity"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span className="c-idcard__foil" aria-hidden />
      <span className="c-idcard__rim" aria-hidden />
      <span className="c-idcard__sweep" aria-hidden />
      <div className="c-idcard__halves">
        <div className="c-idcard__half c-idcard__half--nostr">
          <div className="c-idcard__kicker">
            <span className="c-dot c-dot--nostr" style={{ background: 'var(--dot-nostr)' }} />
            Nostr
          </div>
          {npub ? (
            <div className="c-idcard__who" key={npub}>
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
            <div key={cashaddr} className="c-idcard__bch-body">
              <div className="c-idcard__addr" title={cashaddr}>
                <span className="c-idcard__addr-text">
                  <Fit value={body} long={[10, 8]} short={[7, 6]} />
                </span>
              </div>
              <div className="c-idcard__value">
                <span>{cashaddr!.split(':')[0]}</span>
                <CopyIcon value={cashaddr!} title="Copy address" />
              </div>
            </div>
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
