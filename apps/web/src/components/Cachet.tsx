import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { npubEncode, type Check, type CheckId } from '@cachet/core';
import { Avatar, CopyIcon, IconCheck, IconX, formatDate, shortMiddle } from '@cachet/react';
import { bchPoint, curvePaths, nostrPoint, type CurvePoint } from '../lib/curve.ts';
import { BECH32, HEX_UPPER, prefersReducedMotion, useScramble } from '../lib/useScramble.ts';
import './cachet.css';

/** Signing progresses keys → BCH signature → Nostr signature → sealed (verified). */
export type CachetStage = 'empty' | 'keys' | 'bch' | 'nostr' | 'sealed';
export type CachetVerdict = 'valid' | 'void' | 'muted';
/** Regions of the card a check is about; the ledger lights them as it goes. */
export type CachetZone = 'nostr' | 'bch' | 'statement' | 'time' | 'seal';

export const ZONE_OF: Partial<Record<CheckId, CachetZone>> = {
  event: 'nostr',
  claim: 'statement',
  statement: 'statement',
  identity: 'statement',
  address: 'bch',
  network: 'bch',
  time: 'time',
  bch_signature: 'bch',
  key_separation: 'seal',
};

const STAGES: CachetStage[] = ['empty', 'keys', 'bch', 'nostr', 'sealed'];
const reached = (stage: CachetStage, s: CachetStage) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
const f = (n: number) => (Math.round(n * 100) / 100).toString();

const groupSerial = (hex: string) =>
  hex
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1 ');

/** Bank-card ISO date (YYYY·MM·DD) from unix seconds. */
const formatIsoDate = (sec: number) => {
  const d = new Date(sec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}·${m}·${day}`;
};

/**
 * Monumental Vesica Piscis geometry in 600 × 378 (ISO/IEC 7810 ID-1 1.586:1) space.
 * R = 124 sits cleanly inside the header (y = 53) and footer (y = 325) rules without shaving
 * the bold stroke; HALF_D = 57.2 preserves the exact 6:13 proportion of Cachet's brand mark.
 */
const CX = 456;
const CY = 189;
const R = 124;
const HALF_D = 57.2;
const CURVE_SCALE = 2.2;

const stageGap = (stage: CachetStage, verdict: CachetVerdict): number => {
  if (stage === 'sealed') {
    if (verdict === 'void') return 20;
    if (verdict === 'muted') return 16;
    return 0;
  }
  if (stage === 'nostr') return 4;
  if (stage === 'bch') return 12.5;
  if (stage === 'keys') return 22;
  return 32;
};

export interface CachetProps {
  stage: CachetStage;
  verdict?: CachetVerdict;
  pubkey?: string;
  name?: string;
  picture?: string;
  cashaddr?: string;
  /** The address this card was sealed with; characters of `cashaddr` that differ are marked. */
  sealedCashaddr?: string;
  /** Compressed public key behind the BCH signature (the one it recovers). */
  bchKey?: string;
  tokenAware?: boolean;
  /** Binding ID (SHA-256 of the signed message), shown as the serial number. */
  serial?: string;
  expiresAt?: number;
  focus?: CachetZone;
  overprint?: string;
  status?: ReactNode;
  flipped?: boolean;
  onFlip?: () => void;
  back?: ReactNode;
}

const KeyNode = ({
  at,
  kind,
  label,
  signed,
  inverted,
}: {
  at?: CurvePoint;
  kind: 'p' | 'q';
  label: string;
  signed: boolean;
  inverted?: boolean;
}) => {
  if (!at) return null;
  const x = CX + at.X * CURVE_SCALE;
  const y = CY + at.Y * CURVE_SCALE;
  return (
    <g
      className={`vesica__pt vesica__pt--${kind}${inverted ? ' vesica__pt--inv' : ''}`}
      data-signed={signed || undefined}
      style={{ transform: `translate(${f(x)}px, ${f(y)}px)` }}
    >
      {kind === 'p' ? (
        <>
          <circle className="vesica__pt-halo" r={6.4} />
          <circle className="vesica__pt-dot" r={2.9} />
        </>
      ) : (
        <>
          <rect className="vesica__pt-halo" x={-4.8} y={-4.8} width={9.6} height={9.6} transform="rotate(45)" />
          <rect className="vesica__pt-dot" x={-2.3} y={-2.3} width={4.6} height={4.6} transform="rotate(45)" />
        </>
      )}
      <text
        className="vesica__pt-label"
        x={kind === 'p' ? -8 : 8}
        y={at.Y < 0 ? -5 : 10}
        textAnchor={kind === 'p' ? 'end' : 'start'}
      >
        {label}
      </text>
    </g>
  );
};

/**
 * Monumental Constructivist Vesica Piscis:
 * Left ring = Nostr (BIP-340 Schnorr), Right ring = Bitcoin Cash (ECDSA).
 * When both keys sign one statement, the rings lock in Euclidean phase and ignite the
 * emerald intersection, counter-changing the secp256k1 curve y² = x³ + 7 to crisp white intaglio.
 */
const VesicaMonument = ({
  uid,
  stage,
  verdict,
  p,
  q,
}: {
  uid: string;
  stage: CachetStage;
  verdict: CachetVerdict;
  p?: CurvePoint;
  q?: CurvePoint;
}) => {
  const { up, down } = useMemo(curvePaths, []);
  const sealed = stage === 'sealed';
  const voided = sealed && verdict === 'void';
  const inked = !(sealed && verdict === 'muted');
  const keys = reached(stage, 'keys');
  const bchSigned = inked && reached(stage, 'bch');
  const nostrSigned = inked && reached(stage, 'nostr');

  const gap = stageGap(stage, verdict);
  const d = HALF_D + gap;
  const cx1 = CX - d;
  const cx2 = CX + d;
  const dy = Math.sqrt(Math.max(0, R * R - d * d));
  const lensD = dy > 0 ? `M${f(CX)} ${f(CY - dy)}A${R} ${R} 0 0 1 ${f(CX)} ${f(CY + dy)}A${R} ${R} 0 0 1 ${f(CX)} ${f(CY - dy)}Z` : '';

  const px = p ? CX + p.X * CURVE_SCALE : undefined;
  const py = p ? CY + p.Y * CURVE_SCALE : undefined;
  const qx = q ? CX + q.X * CURVE_SCALE : undefined;
  const qy = q ? CY + q.Y * CURVE_SCALE : undefined;

  // Extended Constructivist secant ray through P and Q
  const secant = useMemo(() => {
    if (px === undefined || py === undefined || qx === undefined || qy === undefined) return undefined;
    const dx = qx - px;
    const dyLine = qy - py;
    const len = Math.hypot(dx, dyLine) || 1;
    const ux = dx / len;
    const uy = dyLine / len;
    return {
      x1: f(px - ux * 160),
      y1: f(py - uy * 160),
      x2: f(qx + ux * 160),
      y2: f(qy + uy * 160),
    };
  }, [px, py, qx, qy]);

  const curveTransform = `translate(${CX} ${CY}) scale(${CURVE_SCALE})`;
  const qLabel = voided ? 'Q′' : 'Q';

  const renderMathLayer = (inverted: boolean) => (
    <g className={inverted ? 'vesica__math vesica__math--inv' : 'vesica__math'}>
      {/* Orthogonal parity axis (y = 0) & Euclidean radical axis (x = CX) */}
      <line className="vesica__axis" x1={276} y1={CY} x2={600} y2={CY} />
      <line className="vesica__axis" x1={CX} y1={53} x2={CX} y2={325} />

      {/* Euclidean equilateral construction rhombus inside the Vesica */}
      {dy > 0 && (
        <polygon
          className="vesica__rhombus"
          points={`${f(cx1)},${CY} ${CX},${f(CY - dy)} ${f(cx2)},${CY} ${CX},${f(CY + dy)}`}
        />
      )}

      {/* Key-separation vertical projections: x_P != x_Q */}
      {keys && px !== undefined && py !== undefined && (
        <line className="vesica__proj vesica__proj--p" x1={f(px)} y1={f(py)} x2={f(px)} y2={CY} />
      )}
      {keys && qx !== undefined && qy !== undefined && (
        <line className="vesica__proj vesica__proj--q" x1={f(qx)} y1={f(qy)} x2={f(qx)} y2={CY} />
      )}

      {/* secp256k1 curve: y² = x³ + 7 */}
      {keys && (
        <g className="vesica__curve" transform={curveTransform}>
          <path d={up} pathLength={1} vectorEffect="non-scaling-stroke" />
          <path d={down} pathLength={1} vectorEffect="non-scaling-stroke" />
        </g>
      )}

      {/* Secant ray & active binding chord PQ */}
      {secant && sealed && verdict !== 'muted' && (
        <line className="vesica__secant" x1={secant.x1} y1={secant.y1} x2={secant.x2} y2={secant.y2} />
      )}
      {sealed && verdict !== 'muted' && px !== undefined && py !== undefined && qx !== undefined && qy !== undefined && (
        <line
          key={`${voided}`}
          className="vesica__chord"
          pathLength={1}
          x1={f(px)}
          y1={f(py)}
          x2={f(qx)}
          y2={f(qy)}
        />
      )}

      <KeyNode at={keys ? q : undefined} kind="q" label={qLabel} signed={bchSigned} inverted={inverted} />
      <KeyNode at={keys ? p : undefined} kind="p" label="P" signed={nostrSigned} inverted={inverted} />
    </g>
  );

  return (
    <svg viewBox="0 0 600 378" preserveAspectRatio="xMidYMid slice" className="vesica" aria-hidden>
      <defs>
        <clipPath id={`${uid}-chamber`}>
          <rect x="0" y="53" width="600" height="272" />
        </clipPath>
        {lensD && (
          <clipPath id={`${uid}-lens`}>
            <path d={lensD} />
          </clipPath>
        )}
        <pattern id={`${uid}-void-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" className="vesica__hatch-line" />
        </pattern>
      </defs>

      <g clipPath={`url(#${uid}-chamber)`}>
        {/* Subtle Constructivist golden-section vertical guide */}
        <line className="vesica__guide" x1={CX - R} y1={53} x2={CX - R} y2={325} />

        {/* Base mathematical engraving outside the lens */}
        {renderMathLayer(false)}

        {/* Solid Emerald Vesica Piscis intersection (or hatched crimson interference when VOID) */}
        {lensD && (
          <path
            d={lensD}
            className="vesica__lens"
            fill={voided ? `url(#${uid}-void-hatch)` : undefined}
          />
        )}

        {/* Counter-changed crisp white intaglio math clipped strictly inside the Emerald Lens */}
        {lensD && sealed && verdict === 'valid' && <g clipPath={`url(#${uid}-lens)`}>{renderMathLayer(true)}</g>}

        {/* The two monumental Cachet circles: Left = Nostr, Right = Bitcoin Cash */}
        <circle
          className="vesica__ring vesica__ring--nostr"
          cx={CX}
          cy={CY}
          r={R}
          style={{ transform: `translateX(${f(-d)}px)` }}
        />
        <circle
          className="vesica__ring vesica__ring--bch"
          cx={CX}
          cy={CY}
          r={R}
          style={{ transform: `translateX(${f(d)}px)` }}
        />

        {/* Precision center crosshairs at O₁ and O₂ */}
        <path
          className="vesica__center"
          d={`M${CX - 4.5} ${CY}H${CX + 4.5}M${CX} ${CY - 4.5}V${CY + 4.5}`}
          style={{ transform: `translateX(${f(-d)}px)` }}
        />
        <path
          className="vesica__center"
          d={`M${CX - 4.5} ${CY}H${CX + 4.5}M${CX} ${CY - 4.5}V${CY + 4.5}`}
          style={{ transform: `translateX(${f(d)}px)` }}
        />
      </g>
    </svg>
  );
};

/** Marks characters that differ from the sealed value once the glyphs have settled. */
const Diff = ({ shown, target, sealed }: { shown: string; target: string; sealed?: string }) => {
  if (!sealed || shown !== target || sealed === target) return <>{shown}</>;
  return (
    <>
      {[...shown].map((ch, i) =>
        ch === sealed[i] ? (
          ch
        ) : (
          <b key={i} className="cachet__diff">
            {ch}
          </b>
        ),
      )}
    </>
  );
};

/**
 * A bank-card credential for one dual-signed binding: two monumental intersecting circles
 * (Nostr & Bitcoin Cash) locking around a single emerald proof lens on secp256k1.
 */
export const Cachet = ({
  stage,
  verdict = 'valid',
  pubkey,
  name,
  picture,
  cashaddr,
  sealedCashaddr,
  bchKey,
  tokenAware,
  serial,
  expiresAt,
  focus,
  overprint,
  status,
  flipped,
  onFlip,
  back,
}: CachetProps) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const npub = pubkey ? npubEncode(pubkey) : '';
  const [, body = ''] = cashaddr ? cashaddr.split(':') : [];
  const sealed = stage === 'sealed';
  const hasKeys = reached(stage, 'keys');
  const inked = !(sealed && verdict === 'muted');
  const bchSigned = inked && reached(stage, 'bch');
  const nostrSigned = inked && reached(stage, 'nostr');

  const npubTarget = hasKeys && npub ? shortMiddle(npub.slice(5), 4, 4) : '';
  const addrTarget = hasKeys && body ? shortMiddle(body, 7, 6) : '';
  const sealedAddr = sealedCashaddr ? shortMiddle(sealedCashaddr.split(':')[1] ?? '', 7, 6) : undefined;
  const npubText = useScramble(npubTarget, { charset: BECH32, duration: 520 });
  const addrText = useScramble(addrTarget, { charset: BECH32, duration: 520, delay: 80 });
  const serialText = useScramble(sealed && serial ? groupSerial(serial) : '', { charset: HEX_UPPER, duration: 600 });

  const p = useMemo(() => (pubkey ? nostrPoint(pubkey) : undefined), [pubkey]);
  const q = useMemo(() => bchPoint(bchKey), [bchKey]);
  const bchParity = bchKey && /^0[23]/.test(bchKey) ? bchKey.slice(0, 2) : undefined;

  const [pressKey, setPressKey] = useState(0);
  useEffect(() => {
    if (sealed) setPressKey((k) => k + 1);
  }, [sealed, verdict]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
      const y = Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
      el.dataset.live = 'true';
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      el.style.setProperty('--px', (x - 0.5).toFixed(3));
      el.style.setProperty('--py', (y - 0.5).toFixed(3));
    });
  };

  const onPointerLeave = () => {
    cancelAnimationFrame(frame.current);
    const el = ref.current;
    if (!el) return;
    delete el.dataset.live;
    el.style.setProperty('--px', '0');
    el.style.setProperty('--py', '0');
  };

  const canFlip = Boolean(onFlip && back);
  const handleCardClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canFlip) return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    if (typeof window !== 'undefined' && (window.getSelection()?.toString().length ?? 0) > 0) return;
    onFlip!();
  };

  return (
    <div
      ref={ref}
      className="cachet"
      data-stage={stage}
      data-verdict={sealed ? verdict : undefined}
      data-focus={focus}
      data-flipped={flipped || undefined}
      data-flippable={canFlip || undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={handleCardClick}
    >
      <div className="cachet__flip">
        <article className="cachet__face cachet__face--front" aria-label="Identity" inert={flipped || undefined}>
          {/* Monumental Constructivist Vesica Piscis geometric field */}
          <div className="cachet__monument" data-zone="seal">
            <VesicaMonument uid={uid} stage={stage} verdict={verdict} p={p} q={q} />
          </div>

          <header className="cachet__head">
            <span className="cachet__brand">
              <span className="cachet__word">CACHET</span>
              <span className="cachet__spec">/ NIP-39</span>
            </span>
            <span className="cachet__serial" data-zone="statement" title="Binding ID: SHA-256 of the signed statement">
              <span className="cachet__no">ID</span>
              <span className="cachet__serial-v">{serialText || '···· ···· ···· ····'}</span>
            </span>
          </header>

          <div className="cachet__body">
            {name && hasKeys && (
              <div className="cachet__holder">
                <Avatar pubkey={pubkey} picture={picture} size={18} />
                <span className="cachet__name" title={name}>
                  {name}
                </span>
              </div>
            )}

            <div className="cachet__reg" data-zone="nostr">
              <div className="cachet__kicker">
                <span className="cachet__idx">01</span>
                <span>NOSTR · BIP-340</span>
                <span className="cachet__mark" data-on={nostrSigned || undefined} aria-hidden>
                  <IconCheck size={10} strokeWidth={2.5} />
                </span>
              </div>
              {npubTarget ? (
                <div className="cachet__field">
                  <span className="cachet__addr cachet__mono" title={npub}>
                    npub1{npubText}
                  </span>
                  <CopyIcon value={npub} title="Copy npub" />
                </div>
              ) : (
                <div className="cachet__field">
                  <span className="c-skel" style={{ width: 156, height: 16 }} />
                </div>
              )}
            </div>

            <div className="cachet__reg" data-zone="bch">
              <div className="cachet__kicker">
                <span className="cachet__idx">02</span>
                <span>BITCOIN CASH · {bchParity ? `ECDSA (${bchParity})` : 'ECDSA'}</span>
                {tokenAware && <span className="cachet__chip-tag">TOKENS</span>}
                <span className="cachet__mark" data-on={bchSigned || (sealed && verdict === 'void') || undefined} aria-hidden>
                  {sealed && verdict === 'void' ? <IconX size={10} strokeWidth={2.6} /> : <IconCheck size={10} strokeWidth={2.5} />}
                </span>
              </div>
              {addrTarget ? (
                <div className="cachet__field">
                  <span className="cachet__addr cachet__mono" title={cashaddr}>
                    <Diff shown={addrText} target={addrTarget} sealed={sealedAddr} />
                  </span>
                  <CopyIcon value={cashaddr!} title="Copy address" />
                </div>
              ) : (
                <div className="cachet__field">
                  <span className="c-skel" style={{ width: 156, height: 16 }} />
                </div>
              )}
            </div>

            <div className="cachet__domain cachet__mono" aria-hidden>
              secp256k1 · y² = x³ + 7 · 2²⁵⁶−2³²−977
            </div>
          </div>

          <footer className="cachet__foot">
            <span className="cachet__status">
              {status}
              {sealed && overprint && <span className="cachet__stamp">{overprint}</span>}
            </span>
            <span className="cachet__foot-end">
              {expiresAt && (
                <span className="cachet__expiry" data-zone="time" title={`Valid until ${formatDate(expiresAt)}`}>
                  <span className="cachet__expiry-k">VALID THRU</span>
                  <span className="cachet__expiry-v cachet__mono">{formatIsoDate(expiresAt)}</span>
                </span>
              )}
              {canFlip && (
                <button
                  type="button"
                  className="cachet__flip-cue cachet__mono"
                  onClick={onFlip}
                  title="Flip card to inspect signed statement"
                  aria-label="Flip card to signed statement"
                >
                  ↻
                </button>
              )}
            </span>
          </footer>

          <span className="cachet__glare" aria-hidden />
          {sealed && verdict === 'valid' && <span key={`s${pressKey}`} className="cachet__sweep" aria-hidden />}
        </article>

        <section className="cachet__face cachet__face--back" aria-label="Signed statement" inert={!flipped || undefined}>
          {back}
        </section>
      </div>
    </div>
  );
};

/** The back of the bank card: magnetic-stripe header, JCS canonical statement, and dual signatures. */
export const CachetBack = ({
  message,
  bchSig,
  eventId,
  nostrSig,
  tampered,
}: {
  message: string;
  bchSig: string;
  eventId: string;
  nostrSig: string;
  tampered?: boolean;
}) => {
  const [head = '', intro = '', json = ''] = message.split('\n');
  const npubAt = intro.lastIndexOf('npub1');
  const addr = json.match(/"cashaddr":"([^"]+)"/)?.[1];
  const [jsonA, jsonB] = addr ? json.split(addr) : [json, ''];

  return (
    <div className="cachet-back">
      <header className="cachet-back__stripe">
        <span className="cachet-back__title">SIGNED STATEMENT · SHA-256D</span>
        <span className="cachet-back__size cachet__mono">
          {message.length} B
          <CopyIcon value={message} title="Copy message" />
        </span>
      </header>
      <pre className="cachet-back__msg">
        <span className="cachet-back__h">{head}</span>
        {'\n'}
        {intro.slice(0, npubAt)}
        <span className="cachet-back__n">{intro.slice(npubAt)}</span>
        {'\n'}
        {jsonA}
        {addr && <span className={tampered ? 'cachet-back__x' : 'cachet-back__b'}>{addr}</span>}
        {jsonB}
      </pre>
      <dl className="cachet-back__rows">
        <div>
          <dt>BCH · ECDSA</dt>
          <dd className="cachet__mono" title={bchSig}>
            {bchSig}
          </dd>
        </div>
        <div>
          <dt>NOSTR · ID</dt>
          <dd className="cachet__mono" title={eventId}>
            {eventId}
          </dd>
        </div>
        <div>
          <dt>SCHNORR · SIG</dt>
          <dd className="cachet__mono" title={nostrSig}>
            {nostrSig}
          </dd>
        </div>
      </dl>
    </div>
  );
};

export interface LedgerProps {
  checks: Check[];
  /** How many rows have resolved; the rest show as pending. */
  shown: number;
  head: ReactNode;
  meta?: ReactNode;
  tone?: 'pending' | 'pass' | 'fail';
  details?: Partial<Record<CheckId, ReactNode>>;
  onHover?: (zone?: CachetZone) => void;
}

/** Frameless Swiss verification index beneath the card. */
export const Ledger = ({ checks, shown, head, meta, tone = 'pending', details, onHover }: LedgerProps) => (
  <div className="ledger" data-tone={tone}>
    <div className="ledger__head">
      <span className="ledger__title">{head}</span>
      {meta && <span className="ledger__meta">{meta}</span>}
    </div>
    <ol className="ledger__rows">
      {checks.map((c, i) => {
        const on = i < shown;
        const status = on ? c.status : 'pending';
        const detail = status === 'skip' ? 'not reached' : (details?.[c.id] ?? c.detail);
        return (
          <li
            key={c.id}
            className="ledger__row"
            data-status={status}
            data-current={on && i === shown - 1 ? true : undefined}
            style={{ '--i': i } as CSSProperties}
            onPointerEnter={() => onHover?.(ZONE_OF[c.id])}
            onPointerLeave={() => onHover?.(undefined)}
          >
            <span className="ledger__mark" aria-label={status}>
              {status === 'pass' && <IconCheck size={11} strokeWidth={2.4} />}
              {status === 'fail' && <IconX size={10} strokeWidth={2.5} />}
            </span>
            <span className="ledger__label">
              {c.label}
              {status === 'fail' && c.code && <span className="ledger__code">{c.code}</span>}
            </span>
            <span className="ledger__detail">{on ? detail : ''}</span>
          </li>
        );
      })}
    </ol>
  </div>
);

/** Steps a ledger through `count` rows each time `run` changes. */
export const useReveal = (count: number, run: string | undefined, step = 150) => {
  const [state, setState] = useState({ shown: 0, done: false, run });
  useEffect(() => {
    setState({ shown: 0, done: false, run });
    if (!run) return;
    if (prefersReducedMotion()) {
      setState({ shown: count, done: true, run });
      return;
    }
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setState((s) => ({ ...s, shown: i + 1 })), 60 + i * step),
    );
    timers.push(setTimeout(() => setState((s) => ({ ...s, done: true })), 60 + count * step + 120));
    return () => timers.forEach(clearTimeout);
  }, [count, run, step]);
  return state.run === run ? state : { shown: 0, done: false, run };
};
