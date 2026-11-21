import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { npubEncode, type BindingState, type Check, type CheckId } from '@cachet/core';
import { Avatar, CopyIcon, IconCheck, IconX, formatDate, shortMiddle } from '@cachet/react';
import { bchPoint, curvePaths, nostrPoint, type CurvePoint } from '../lib/curve.ts';
import { BECH32, HEX_UPPER, useScramble } from '../lib/useScramble.ts';
import { prefersReducedMotion } from '../lib/motion.ts';
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

/** Word stamped on a sealed card that must not be trusted; it replaces the status pill. */
export const STAMP_OF: Partial<Record<BindingState, string>> = { invalid: 'VOID', withdrawn: 'WITHDRAWN', expired: 'EXPIRED' };

const STAGES: CachetStage[] = ['empty', 'keys', 'bch', 'nostr', 'sealed'];
const reached = (stage: CachetStage, s: CachetStage) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
const f = (n: number) => (Math.round(n * 100) / 100).toString();
const DEG = Math.PI / 180;
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

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
const RING_HALF = 5.75;
const SPOT_R = 102;
/** Lowercase + digit optical midpoint sits ~0.26em above alphabetic baseline (~2.42px at 9.3px). */
const TEXT_R_OFFSET = 2.42;
/** Antipodal axis through the Euclidean Vesica apexes: atan2(dy, -HALF_D) ≈ 117.5° and 297.5°. */
const POLE_DEG = 117.5;

const polar = (r: number, deg: number) => {
  const rad = deg * DEG;
  return `${f(CX + r * Math.cos(rad))} ${f(CY + r * Math.sin(rad))}`;
};

const RING_ARC_CW = `M${polar(R - TEXT_R_OFFSET, POLE_DEG + 2)}A${f(R - TEXT_R_OFFSET)} ${f(R - TEXT_R_OFFSET)} 0 0 1 ${polar(R - TEXT_R_OFFSET, POLE_DEG + 178)}`;
const RING_ARC_CCW = `M${polar(R + TEXT_R_OFFSET, POLE_DEG - 2)}A${f(R + TEXT_R_OFFSET)} ${f(R + TEXT_R_OFFSET)} 0 0 0 ${polar(R + TEXT_R_OFFSET, POLE_DEG - 178)}`;
const POLE_A = { x: f(CX + R * Math.cos(POLE_DEG * DEG)), y: f(CY + R * Math.sin(POLE_DEG * DEG)) };
const POLE_B = { x: f(CX + R * Math.cos((POLE_DEG + 180) * DEG)), y: f(CY + R * Math.sin((POLE_DEG + 180) * DEG)) };
const ringTrack = (n: number) => (n > 1 ? f(Math.min(2.1, Math.max(0.02, (348 - n * 5.56) / (n - 1)))) : '0');

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
  /** Placeholder copy for the Nostr slot before a key is connected. */
  emptyNostr?: string;
  name?: string;
  picture?: string;
  cashaddr?: string;
  /** Placeholder copy for the BCH slot when resolved with no linked address. */
  emptyBch?: string;
  /** The address this card was sealed with; characters of `cashaddr` that differ are marked. */
  sealedCashaddr?: string;
  /** Compressed public key behind the BCH signature (the one it recovers). */
  bchKey?: string;
  tokenAware?: boolean;
  /** Binding ID (SHA-256 of the signed message), shown as the serial number. */
  serial?: string;
  expiresAt?: number;
  focus?: CachetZone;
  /** Stamp shown instead of `status` once sealed (VOID, WITHDRAWN, EXPIRED). */
  overprint?: string;
  status?: ReactNode;
  /** Static front only: no 3D rig, glare or entrance animation. */
  flat?: boolean;
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
 * anodized emerald intersection, counter-changing y² = x³ + 7 to crisp white intaglio.
 */
const VesicaMonument = ({
  uid,
  stage,
  verdict,
  p,
  q,
  npub,
  cashaddr,
  svgRef,
  cutSpotRef,
  showSpotRef,
}: {
  uid: string;
  stage: CachetStage;
  verdict: CachetVerdict;
  p?: CurvePoint;
  q?: CurvePoint;
  npub?: string;
  cashaddr?: string;
  svgRef?: RefObject<SVGSVGElement | null>;
  cutSpotRef?: RefObject<SVGCircleElement | null>;
  showSpotRef?: RefObject<SVGCircleElement | null>;
}) => {
  const { up, down } = useMemo(curvePaths, []);
  const sealed = stage === 'sealed';
  const voided = sealed && verdict === 'void';
  const muted = sealed && verdict === 'muted';
  const inked = !muted;
  const keys = reached(stage, 'keys');
  const bchSigned = inked && reached(stage, 'bch');
  const nostrSigned = inked && reached(stage, 'nostr');

  const gap = stageGap(stage, verdict);
  const d = HALF_D + gap;
  const cx1 = CX - d;
  const cx2 = CX + d;
  const dy = Math.sqrt(Math.max(0, R * R - d * d));
  const halfRing = muted ? 4.25 : RING_HALF;
  const rLens = R - (halfRing - 0.15);
  const dyLens = Math.sqrt(Math.max(0, rLens * rLens - d * d));
  const lensD =
    dyLens > 0
      ? `M${f(CX)} ${f(CY - dyLens)}A${f(rLens)} ${f(rLens)} 0 0 1 ${f(CX)} ${f(CY + dyLens)}A${f(rLens)} ${f(rLens)} 0 0 1 ${f(CX)} ${f(CY - dyLens)}Z`
      : '';

  const showNostr = keys && Boolean(npub);
  const showBch = keys && Boolean(cashaddr);
  const nostrSpacing = npub ? ringTrack(npub.length) : '0';
  const bchSpacing = cashaddr ? ringTrack(cashaddr.length) : '0';

  const px = p ? CX + p.X * CURVE_SCALE : undefined;
  const py = p ? CY + p.Y * CURVE_SCALE : undefined;
  const qx = q ? CX + q.X * CURVE_SCALE : undefined;
  const qy = q ? CY + q.Y * CURVE_SCALE : undefined;

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
      <line className="vesica__axis" x1={276} y1={CY} x2={600} y2={CY} />
      <line className="vesica__axis" x1={CX} y1={53} x2={CX} y2={325} />

      {dy > 0 && (
        <polygon
          className="vesica__rhombus"
          points={`${f(cx1)},${CY} ${CX},${f(CY - dy)} ${f(cx2)},${CY} ${CX},${f(CY + dy)}`}
        />
      )}

      {keys && px !== undefined && py !== undefined && (
        <line className="vesica__proj vesica__proj--p" x1={f(px)} y1={f(py)} x2={f(px)} y2={CY} />
      )}
      {keys && qx !== undefined && qy !== undefined && (
        <line className="vesica__proj vesica__proj--q" x1={f(qx)} y1={f(qy)} x2={f(qx)} y2={CY} />
      )}

      {keys && (
        <g className="vesica__curve" transform={curveTransform}>
          <path d={up} pathLength={1} vectorEffect="non-scaling-stroke" />
          <path d={down} pathLength={1} vectorEffect="non-scaling-stroke" />
        </g>
      )}

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
    <svg ref={svgRef} viewBox="0 0 600 378" preserveAspectRatio="xMidYMid slice" className="vesica" aria-hidden>
      <defs>
        <clipPath id={`${uid}-chamber`}>
          <rect x="0" y="53" width="600" height="272" />
        </clipPath>
        {lensD && (
          <clipPath id={`${uid}-lens`}>
            <path d={lensD} />
          </clipPath>
        )}
        <linearGradient id={`${uid}-emerald`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--lens-top)" />
          <stop offset="52%" stopColor="var(--lens-mid)" />
          <stop offset="100%" stopColor="var(--lens-bot)" />
        </linearGradient>
        <pattern id={`${uid}-void-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" className="vesica__hatch-line" />
        </pattern>
        {(showNostr || showBch) && (
          <>
            <path id={`${uid}-arc-cw`} d={RING_ARC_CW} />
            <path id={`${uid}-arc-ccw`} d={RING_ARC_CCW} />
            <radialGradient id={`${uid}-grad-cut`}>
              <stop offset="0%" stopColor="#000" stopOpacity="1" />
              <stop offset="60%" stopColor="#000" stopOpacity="1" />
              <stop offset="78%" stopColor="#000" stopOpacity="0.52" />
              <stop offset="94%" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${uid}-grad-show`}>
              <stop offset="0%" stopColor="#fff" stopOpacity="1" />
              <stop offset="56%" stopColor="#fff" stopOpacity="1" />
              <stop offset="76%" stopColor="#fff" stopOpacity="0.45" />
              <stop offset="90%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <mask id={`${uid}-ring-cut`} maskUnits="userSpaceOnUse" x="-40" y="0" width="680" height="378">
              <rect x="-40" y="0" width="680" height="378" fill="#fff" />
              <circle ref={cutSpotRef} cx="-999" cy="-999" r={SPOT_R} fill={`url(#${uid}-grad-cut)`} opacity="0" />
            </mask>
            <mask id={`${uid}-addr-show`} maskUnits="userSpaceOnUse" x="-40" y="0" width="680" height="378">
              <rect x="-40" y="0" width="680" height="378" fill="#000" />
              <circle ref={showSpotRef} cx="-999" cy="-999" r={SPOT_R} fill={`url(#${uid}-grad-show)`} opacity="0" />
            </mask>
            {showNostr && showBch && dy > 0 && (
              <mask id={`${uid}-nostr-cross`} maskUnits="userSpaceOnUse" x="-40" y="0" width="680" height="378">
                <rect x="-40" y="0" width="680" height="378" fill="#fff" />
                <circle cx={f(cx2)} cy={CY} r={R} fill="none" stroke="#000" strokeWidth={halfRing * 2 + 1} />
              </mask>
            )}
          </>
        )}
      </defs>

      <g clipPath={`url(#${uid}-chamber)`}>
        <line className="vesica__guide" x1={CX - R} y1={53} x2={CX - R} y2={325} />

        {renderMathLayer(false)}

        {lensD && (
          <path
            d={lensD}
            className="vesica__lens"
            fill={voided ? `url(#${uid}-void-hatch)` : verdict === 'muted' && sealed ? undefined : `url(#${uid}-emerald)`}
          />
        )}

        {lensD && sealed && verdict === 'valid' && <g clipPath={`url(#${uid}-lens)`}>{renderMathLayer(true)}</g>}

        {(showNostr || showBch) && (
          <g className="vesica__reveal" mask={`url(#${uid}-addr-show)`}>
            {showNostr && (
              <g mask={showBch && dy > 0 ? `url(#${uid}-nostr-cross)` : undefined}>
                <g className="vesica__addr-ring vesica__addr-ring--nostr" style={{ transform: `translateX(${f(-d)}px)` }}>
                  <circle className="vesica__rail" cx={CX} cy={CY} r={R - halfRing} />
                  <circle className="vesica__rail" cx={CX} cy={CY} r={R + halfRing} />
                  <circle className="vesica__pole" cx={POLE_A.x} cy={POLE_A.y} r={1.05} />
                  <circle className="vesica__pole" cx={POLE_B.x} cy={POLE_B.y} r={1.05} />
                  <text className="vesica__ring-text" style={{ letterSpacing: `${nostrSpacing}px` }}>
                    <textPath href={`#${uid}-arc-cw`} startOffset="50%" textAnchor="middle">
                      {npub}
                    </textPath>
                  </text>
                  <text className="vesica__ring-text" style={{ letterSpacing: `${nostrSpacing}px` }}>
                    <textPath href={`#${uid}-arc-ccw`} startOffset="50%" textAnchor="middle">
                      {npub}
                    </textPath>
                  </text>
                </g>
              </g>
            )}
            {showBch && (
              <g className="vesica__addr-ring vesica__addr-ring--bch" style={{ transform: `translateX(${f(d)}px)` }}>
                <circle className="vesica__rail" cx={CX} cy={CY} r={R - halfRing} />
                <circle className="vesica__rail" cx={CX} cy={CY} r={R + halfRing} />
                <circle className="vesica__pole" cx={POLE_A.x} cy={POLE_A.y} r={1.05} />
                <circle className="vesica__pole" cx={POLE_B.x} cy={POLE_B.y} r={1.05} />
                <text className="vesica__ring-text" style={{ letterSpacing: `${bchSpacing}px` }}>
                  <textPath href={`#${uid}-arc-cw`} startOffset="50%" textAnchor="middle">
                    {cashaddr}
                  </textPath>
                </text>
                <text className="vesica__ring-text" style={{ letterSpacing: `${bchSpacing}px` }}>
                  <textPath href={`#${uid}-arc-ccw`} startOffset="50%" textAnchor="middle">
                    {cashaddr}
                  </textPath>
                </text>
              </g>
            )}
          </g>
        )}

        <g mask={showNostr ? `url(#${uid}-ring-cut)` : undefined}>
          <circle
            className="vesica__ring vesica__ring--nostr"
            cx={CX}
            cy={CY}
            r={R}
            style={{ transform: `translateX(${f(-d)}px)` }}
          />
        </g>
        <g mask={showBch ? `url(#${uid}-ring-cut)` : undefined}>
          <circle
            className="vesica__ring vesica__ring--bch"
            cx={CX}
            cy={CY}
            r={R}
            style={{ transform: `translateX(${f(d)}px)` }}
          />
        </g>

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
 * Tactile 3D spring physics state for the machined metal bank card:
 * decouples hover micro-tilt from full 180° Z-lifted flip & interactive 3D drag inspection.
 */
interface PhysicsState {
  angle: number;
  vel: number;
  target: number;
  tiltX: number;
  tiltY: number;
  goalTiltX: number;
  goalTiltY: number;
  spot: number;
  goalSpot: number;
  spotX: number;
  spotY: number;
  goalSpotX: number;
  goalSpotY: number;
  dragging: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  startAngle: number;
  lastX: number;
  lastT: number;
  moved: boolean;
}

/**
 * One dual-signed binding as a card. The front carries both keys and the seal; the back carries the
 * exact signed statement. Click or drag to flip; `flat` renders the front alone with no 3D rig.
 */
export const Cachet = ({
  stage,
  verdict = 'valid',
  pubkey,
  emptyNostr,
  name,
  picture,
  cashaddr,
  emptyBch,
  sealedCashaddr,
  bchKey,
  tokenAware,
  serial,
  expiresAt,
  focus,
  overprint,
  status,
  flat = false,
  flipped = false,
  onFlip,
  back,
}: CachetProps) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cutSpotRef = useRef<SVGCircleElement>(null);
  const showSpotRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number>(0);
  const phys = useRef<PhysicsState>({
    angle: flipped ? 180 : 0,
    vel: 0,
    target: flipped ? 180 : 0,
    tiltX: 0,
    tiltY: 0,
    goalTiltX: 0,
    goalTiltY: 0,
    spot: 0,
    goalSpot: 0,
    spotX: -999,
    spotY: -999,
    goalSpotX: -999,
    goalSpotY: -999,
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startAngle: 0,
    lastX: 0,
    lastT: 0,
    moved: false,
  });
  const prevFlipped = useRef(flipped);

  const npub = pubkey ? npubEncode(pubkey) : '';
  const [, body = ''] = cashaddr ? cashaddr.split(':') : [];
  const sealed = stage === 'sealed';
  const hasKeys = reached(stage, 'keys');
  const inked = !(sealed && verdict === 'muted');
  const bchSigned = inked && reached(stage, 'bch');
  const nostrSigned = inked && reached(stage, 'nostr');

  const npubTarget = hasKeys && npub ? shortMiddle(npub.slice(5), 4, 4) : '';
  const addrTarget = hasKeys && body ? shortMiddle(body, 7, 6) : '';
  const serialTarget = sealed && serial ? groupSerial(serial) : '';
  const sealedAddr = sealedCashaddr ? shortMiddle(sealedCashaddr.split(':')[1] ?? '', 7, 6) : undefined;
  const npubScrambled = useScramble(flat ? '' : npubTarget, { charset: BECH32, duration: 520 });
  const addrScrambled = useScramble(flat ? '' : addrTarget, { charset: BECH32, duration: 520, delay: 80 });
  const serialScrambled = useScramble(flat ? '' : serialTarget, { charset: HEX_UPPER, duration: 600 });
  const npubText = flat ? npubTarget : npubScrambled;
  const addrText = flat ? addrTarget : addrScrambled;
  const serialText = flat ? serialTarget : serialScrambled;

  const p = useMemo(() => (pubkey ? nostrPoint(pubkey) : undefined), [pubkey]);
  const q = useMemo(() => bchPoint(bchKey), [bchKey]);
  const bchParity = bchKey && /^0[23]/.test(bchKey) ? bchKey.slice(0, 2) : undefined;
  const ringOverhang = 300 - (CX - HALF_D - stageGap(stage, verdict) - R - RING_HALF);
  const canFlip = !flat && Boolean(onFlip && back);

  const [pressKey, setPressKey] = useState(0);
  useEffect(() => {
    if (sealed) setPressKey((k) => k + 1);
  }, [sealed, verdict]);

  const applyTransform = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const s = phys.current;
    const rad = s.angle * DEG;
    const sinA = Math.abs(Math.sin(rad));
    const liftZ = sinA * 62;
    const bankZ = Math.sin(rad * 2) * -1.85;
    const pitchLift = sinA * 5.2;

    // The sheen band crosses each face once per half turn, whatever the number of turns.
    const fAngle = wrap180(s.angle);
    const bAngle = wrap180(s.angle - 180);
    const frontSheen = 50 + (fAngle / 90) * 64;
    const backSheen = 50 + (bAngle / 90) * 64;

    el.style.setProperty('--flip-deg', `${s.angle.toFixed(2)}deg`);
    el.style.setProperty('--lift-z', `${liftZ.toFixed(1)}px`);
    el.style.setProperty('--bank-z', `${bankZ.toFixed(2)}deg`);
    el.style.setProperty('--tilt-x', `${(s.tiltX + pitchLift).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${s.tiltY.toFixed(2)}deg`);
    el.style.setProperty('--sh-sx', (1 - sinA * 0.58).toFixed(3));
    el.style.setProperty('--sh-sy', (1 + sinA * 0.08).toFixed(3));
    el.style.setProperty('--sh-blur', `${(22 + sinA * 22).toFixed(1)}px`);
    el.style.setProperty('--sh-alpha', (1 - sinA * 0.34).toFixed(3));
    el.style.setProperty('--sheen-f', `${frontSheen.toFixed(1)}%`);
    el.style.setProperty('--sheen-b', `${backSheen.toFixed(1)}%`);
    el.style.setProperty('--turn-glow', sinA.toFixed(3));
  }, []);

  const applySpot = useCallback(() => {
    const s = phys.current;
    const vis = s.spot > 0.004;
    const cx = vis ? s.spotX.toFixed(1) : '-999';
    const cy = vis ? s.spotY.toFixed(1) : '-999';
    const op = vis ? s.spot.toFixed(3) : '0';
    for (const node of [cutSpotRef.current, showSpotRef.current]) {
      if (!node) continue;
      node.setAttribute('cx', cx);
      node.setAttribute('cy', cy);
      node.setAttribute('opacity', op);
    }
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current) return;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.032);
      prev = now;
      const s = phys.current;

      const spotLerp = 1 - Math.exp(-15 * dt);
      const posLerp = 1 - Math.exp(-26 * dt);
      s.spot += (s.goalSpot - s.spot) * spotLerp;
      s.spotX += (s.goalSpotX - s.spotX) * posLerp;
      s.spotY += (s.goalSpotY - s.spotY) * posLerp;
      applySpot();

      let settledCard = true;
      if (!flat) {
        const tiltLerp = 1 - Math.exp(-14 * dt);
        s.tiltX += (s.goalTiltX - s.tiltX) * tiltLerp;
        s.tiltY += (s.goalTiltY - s.tiltY) * tiltLerp;

        if (!s.dragging) {
          // Slightly underdamped spring: the card settles with one small overshoot.
          const stiffness = 115;
          const damping = 18.5;
          const force = (s.target - s.angle) * stiffness - s.vel * damping;
          s.vel += force * dt;
          s.angle += s.vel * dt;
        }

        applyTransform();

        const settledFlip = s.dragging ? false : Math.abs(s.target - s.angle) < 0.06 && Math.abs(s.vel) < 0.4;
        const settledTilt = Math.abs(s.goalTiltX - s.tiltX) < 0.03 && Math.abs(s.goalTiltY - s.tiltY) < 0.03;
        settledCard = settledFlip && settledTilt;
        if (settledCard) {
          s.angle = s.target;
          s.vel = 0;
          s.tiltX = s.goalTiltX;
          s.tiltY = s.goalTiltY;
          applyTransform();
        }
      }

      const settledSpot =
        Math.abs(s.goalSpot - s.spot) < 0.005 &&
        (s.goalSpot === 0 || (Math.abs(s.goalSpotX - s.spotX) < 0.3 && Math.abs(s.goalSpotY - s.spotY) < 0.3));

      if (settledCard && settledSpot) {
        s.spot = s.goalSpot;
        if (s.goalSpot > 0) {
          s.spotX = s.goalSpotX;
          s.spotY = s.goalSpotY;
        }
        applySpot();
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [flat, applyTransform, applySpot]);

  useEffect(() => {
    if (flat || prevFlipped.current === flipped) return;
    prevFlipped.current = flipped;
    const s = phys.current;
    const curStep = Math.round(s.target / 180);
    const curIsBack = Math.abs(curStep) % 2 === 1;
    const nextTarget = curIsBack === flipped ? s.target : (curStep + 1) * 180;

    if (prefersReducedMotion()) {
      s.target = nextTarget;
      s.angle = nextTarget;
      s.vel = 0;
      applyTransform();
      return;
    }
    if (s.target !== nextTarget) {
      if (Math.abs(s.vel) < 15) {
        s.vel += nextTarget > s.angle ? 68 : -68;
      }
      s.target = nextTarget;
      startLoop();
    }
  }, [flipped, applyTransform, startLoop]);

  useEffect(() => {
    if (!flat) applyTransform();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [flat, applyTransform]);

  const trackSpot = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const sr = svg.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const s = phys.current;
    const scale = Math.max(sr.width / 600, sr.height / 378);
    const sx = (clientX - sr.left - (sr.width - 600 * scale) / 2) / scale;
    const sy = (clientY - sr.top - (sr.height - 378 * scale) / 2) / scale;
    if (s.spot < 0.02) {
      s.spotX = sx;
      s.spotY = sy;
    }
    s.goalSpotX = sx;
    s.goalSpotY = sy;
    s.goalSpot = 1;
    if (prefersReducedMotion()) {
      s.spot = 1;
      s.spotX = sx;
      s.spotY = sy;
      applySpot();
    } else {
      startLoop();
    }
  };

  const clearSpot = () => {
    const s = phys.current;
    s.goalSpot = 0;
    if (prefersReducedMotion()) {
      s.spot = 0;
      applySpot();
    } else {
      startLoop();
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canFlip || e.button !== 0) return;
    const targetEl = e.target as HTMLElement;
    // Allow copy buttons, links, and statement text selection to work natively
    if (targetEl.closest('button, a, pre')) return;

    const s = phys.current;
    s.dragging = false;
    s.pointerId = e.pointerId;
    s.startX = e.clientX;
    s.startY = e.clientY;
    s.startAngle = s.angle;
    s.lastX = e.clientX;
    s.lastT = performance.now();
    s.moved = false;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && !flipped) {
      trackSpot(e.clientX, e.clientY);
    }
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const s = phys.current;

    if (s.pointerId === e.pointerId) {
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (!s.moved && Math.hypot(dx, dy) > 6) {
        // A mostly horizontal drag scrubs the flip; a vertical one is left to page scroll.
        if (Math.abs(dx) >= Math.abs(dy) * 0.8) {
          s.moved = true;
          s.dragging = true;
          el.dataset.dragging = 'true';
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // Ignore capture errors on synthetic events
          }
        } else {
          s.pointerId = -1;
        }
      }
      if (s.dragging) {
        const now = performance.now();
        const dtMs = Math.max(now - s.lastT, 8);
        const vx = ((e.clientX - s.lastX) / dtMs) * 1000 * 0.42;
        s.vel = vx;
        s.lastX = e.clientX;
        s.lastT = now;
        s.angle = s.startAngle + dx * 0.48;
        startLoop();
      }
    }

    if (e.pointerType === 'mouse') {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      const y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
      el.dataset.live = 'true';
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      s.goalTiltX = (0.5 - y) * 6.8;
      s.goalTiltY = (x - 0.5) * 8.4;
      startLoop();
    }
  };

  const finishPointer = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const el = ref.current;
    const s = phys.current;
    if (s.pointerId !== e.pointerId) return;
    s.pointerId = -1;

    if (s.dragging) {
      s.dragging = false;
      if (el) {
        delete el.dataset.dragging;
        try {
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }
      if (!cancelled && onFlip) {
        const projected = s.angle + s.vel * 0.14;
        const nearestStep = Math.round(projected / 180);
        s.target = nearestStep * 180;
        const wantBack = Math.abs(nearestStep) % 2 === 1;
        if (wantBack !== flipped) {
          prevFlipped.current = wantBack;
          onFlip();
        }
      }
      startLoop();
      return;
    }

    if (!cancelled && !s.moved && canFlip) {
      const targetEl = e.target as HTMLElement;
      if (!targetEl.closest('button, a, pre')) {
        if (typeof window === 'undefined' || (window.getSelection()?.toString().length ?? 0) === 0) {
          onFlip!();
        }
      }
    }
  };

  const onPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const s = phys.current;
    clearSpot();
    if (!s.dragging) {
      s.pointerId = -1;
      if (el) delete el.dataset.live;
      s.goalTiltX = 0;
      s.goalTiltY = 0;
      startLoop();
    } else {
      finishPointer(e, false);
    }
  };

  const frontContent = (
    <>
      <div className="cachet__monument" data-zone="seal">
        <VesicaMonument
          uid={uid}
          stage={stage}
          verdict={verdict}
          p={p}
          q={q}
          npub={npub || undefined}
          cashaddr={cashaddr}
          svgRef={svgRef}
          cutSpotRef={cutSpotRef}
          showSpotRef={showSpotRef}
        />
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

      <div className="cachet__body" style={{ '--ring-overhang': ringOverhang } as CSSProperties}>
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
            <span>
              NOSTR<span className="cachet__scheme"> · BIP-340</span>
            </span>
          </div>
          {npubTarget ? (
            <div className="cachet__field">
              <span className="cachet__addr cachet__mono" title={npub}>
                npub1{npubText}
              </span>
              <span className="cachet__mark" data-on={nostrSigned || undefined} aria-hidden>
                <IconCheck size={11} strokeWidth={2.5} />
              </span>
              <CopyIcon value={npub} title="Copy npub" />
            </div>
          ) : emptyNostr ? (
            <div className="cachet__field">
              <span className="cachet__addr cachet__addr--empty">{emptyNostr}</span>
            </div>
          ) : (
            <div className="cachet__field">
              <span className="c-skel" style={{ width: 156, height: 16 }} />
            </div>
          )}
        </div>

        <div className="cachet__reg" data-zone="bch">
          <div className="cachet__kicker cachet__kicker--bch">
            <span className="cachet__kicker-title">
              <span className="cachet__idx">02</span>
              BITCOIN CASH
            </span>
            <span className="cachet__scheme">· {bchParity ? `ECDSA (${bchParity})` : 'ECDSA'}</span>
            {tokenAware && <span className="cachet__chip-tag">TOKENS</span>}
          </div>
          {addrTarget ? (
            <div className="cachet__field">
              <span className="cachet__addr cachet__mono" title={cashaddr}>
                <Diff shown={addrText} target={addrTarget} sealed={sealedAddr} />
              </span>
              <span className="cachet__mark" data-on={bchSigned || (sealed && verdict === 'void') || undefined} aria-hidden>
                {sealed && verdict === 'void' ? <IconX size={11} strokeWidth={2.6} /> : <IconCheck size={11} strokeWidth={2.5} />}
              </span>
              <CopyIcon value={cashaddr!} title="Copy address" />
            </div>
          ) : emptyBch ? (
            <div className="cachet__field">
              <span className="cachet__addr cachet__addr--empty">{emptyBch}</span>
            </div>
          ) : (
            <div className="cachet__field">
              <span className="c-skel" style={{ width: 156, height: 16 }} />
            </div>
          )}
        </div>

        <div className="cachet__domain cachet__mono" aria-hidden>
          <span>secp256k1 · y² = x³ + 7</span>
          <span>p = 2²⁵⁶ − 2³² − 977</span>
        </div>
      </div>

      <footer className="cachet__foot">
        <span className="cachet__status">{sealed && overprint ? <span className="cachet__stamp">{overprint}</span> : status}</span>
        {expiresAt && (
          <span className="cachet__expiry" data-zone="time" title={`Valid until ${formatDate(expiresAt)}`}>
            <span className="cachet__expiry-k">VALID THRU</span>
            <span className="cachet__expiry-v cachet__mono">{formatIsoDate(expiresAt)}</span>
          </span>
        )}
      </footer>
    </>
  );

  if (flat) {
    return (
      <div
        className="cachet"
        data-flat
        data-stage={stage}
        data-verdict={sealed ? verdict : undefined}
        data-focus={focus}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') trackSpot(e.clientX, e.clientY);
        }}
        onPointerLeave={clearSpot}
      >
        <article className="cachet__face cachet__face--front" aria-label="Identity">
          {frontContent}
        </article>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="cachet"
      data-stage={stage}
      data-verdict={sealed ? verdict : undefined}
      data-focus={focus}
      data-flipped={flipped || undefined}
      data-flippable={canFlip || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishPointer(e, false)}
      onPointerCancel={(e) => finishPointer(e, true)}
      onPointerLeave={onPointerLeave}
    >
      <div className="cachet__ground-shadow" aria-hidden />

      <div className="cachet__tilt">
        <div className="cachet__rotor">
          {/* Edge slices between the front (+2.2px) and back (−2.2px) faces give the card thickness. */}
          <span className="cachet__edge cachet__edge--a" aria-hidden />
          <span className="cachet__edge cachet__edge--b" aria-hidden />
          <span className="cachet__edge cachet__edge--c" aria-hidden />

          <article className="cachet__face cachet__face--front" aria-label="Identity" inert={flipped || undefined}>
            <span className="cachet__grain" aria-hidden />
            <span className="cachet__chamfer" aria-hidden />
            {frontContent}
            <span className="cachet__glare" aria-hidden />
            <span className="cachet__turn-sheen cachet__turn-sheen--front" aria-hidden />
            {sealed && verdict === 'valid' && <span key={`s${pressKey}`} className="cachet__sweep" aria-hidden />}
          </article>

          <section className="cachet__face cachet__face--back" aria-label="Signed statement" inert={!flipped || undefined}>
            <span className="cachet__grain" aria-hidden />
            <span className="cachet__chamfer" aria-hidden />
            {back}
            <span className="cachet__glare" aria-hidden />
            <span className="cachet__turn-sheen cachet__turn-sheen--back" aria-hidden />
          </section>
        </div>
      </div>
    </div>
  );
};

/** Card flip glyph shared by interactive `<Cachet>` toolbars. */
export const IconFlip = ({ size = 13 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M8 2v12" strokeDasharray="1.4 1.8" />
    <path d="M5.75 4.5 2.25 11.5h3.5Z" />
    <path d="M10.25 4.5l3.5 7h-3.5Z" />
  </svg>
);

/** The back face on its own, laid flat next to `<Cachet flat />`. */
export const CachetBackCard = ({
  verdict = 'valid',
  sealed = false,
  children,
}: {
  verdict?: CachetVerdict;
  sealed?: boolean;
  children: ReactNode;
}) => (
  <div className="cachet" data-flat data-stage={sealed ? 'sealed' : 'empty'} data-verdict={sealed ? verdict : undefined}>
    <section className="cachet__face cachet__face--back-flat" aria-label="Signed statement">
      {children}
    </section>
  </div>
);

export interface CachetBackProps {
  message?: string;
  bchSig?: string;
  eventId?: string;
  nostrSig?: string;
  tampered?: boolean;
  loading?: boolean;
  emptyNote?: string;
}

/** One canonical-JSON token: a key string, a value string, structural punctuation, or a bare literal. */
const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(?=:)|("(?:[^"\\]|\\.)*")|([{}[\],:])|([^"{}[\],:]+)/g;

/** Values at least this long (hex nonces, keys, addresses) may start on a fresh line rather than split. */
const LONG_VALUE = 24;

/**
 * The exact signed JSON, tinted so structure recedes and values read. Soft breaks after each comma
 * and before long values let lines wrap at field boundaries without changing a byte of the text.
 */
const StatementJson = ({ json, addr, tampered }: { json: string; addr?: string; tampered?: boolean }) => {
  const tokens = [...json.matchAll(JSON_TOKEN)];
  return (
    <>
      {tokens.map(([, key, str, punct, literal], i) => {
        if (key) return <span key={i} className="cachet-back__k">{key}</span>;
        if (punct) {
          const next = tokens[i + 1]?.[2];
          const softBreak = punct === ',' || (punct === ':' && next !== undefined && next.length >= LONG_VALUE);
          return (
            <Fragment key={i}>
              <span className="cachet-back__p">{punct}</span>
              {softBreak && <wbr />}
            </Fragment>
          );
        }
        if (str && addr && str === `"${addr}"`) {
          return (
            <Fragment key={i}>
              "<span className={tampered ? 'cachet-back__x' : 'cachet-back__b'}>{addr}</span>"
            </Fragment>
          );
        }
        return <Fragment key={i}>{str ?? literal}</Fragment>;
      })}
    </>
  );
};

const BACK_SIGS = [
  { key: 'eventId', label: 'EVENT ID', title: 'Nostr event ID (SHA-256)' },
  { key: 'nostrSig', label: 'NOSTR SIG', title: 'Schnorr signature (BIP-340)' },
  { key: 'bchSig', label: 'BCH SIG', title: 'ECDSA signature (Bitcoin Signed Message)' },
] as const;

/**
 * The reverse of the card, drawn on the same grid as the front: header and footer bands at the
 * 14% datum, the exact signed statement set directly on the plate, and the three signatures that
 * seal it filed along the footer beside a miniature of the front's Vesica.
 */
export const CachetBack = ({
  message,
  bchSig,
  eventId,
  nostrSig,
  tampered,
  loading,
  emptyNote,
}: CachetBackProps) => {
  const [head = '', intro = '', json = ''] = (message ?? '').split('\n');
  const npubAt = intro.lastIndexOf('npub1');
  const addr = json.match(/"cashaddr":"([^"]+)"/)?.[1];
  const sigs = { eventId, nostrSig, bchSig };

  return (
    <div className="cachet-back">
      <header className="cachet__head cachet-back__head">
        <span className="cachet__brand">
          <span className="cachet__word">STATEMENT</span>
          <span className="cachet__spec">/ SHA-256D</span>
        </span>
        <span className="cachet-back__size">
          <span className="cachet__no">BYTES</span>
          <span className="cachet-back__size-v">{message ? message.length : '···'}</span>
          {message && <CopyIcon value={message} title="Copy signed message" />}
        </span>
      </header>

      <div className="cachet-back__body">
        {message ? (
          <pre className="cachet-back__msg">
            <span className="cachet-back__h">{head}</span>
            {'\n'}
            {npubAt >= 0 ? (
              <>
                {intro.slice(0, npubAt)}
                <span className="cachet-back__n">{intro.slice(npubAt)}</span>
              </>
            ) : (
              intro
            )}
            {'\n'}
            <StatementJson json={json} addr={addr} tampered={tampered} />
          </pre>
        ) : loading ? (
          <div className="cachet-back__empty">
            <span className="c-skel" style={{ width: '72%', height: 12 }} />
            <span className="c-skel" style={{ width: '88%', height: 12 }} />
            <span className="c-skel" style={{ width: '54%', height: 12 }} />
          </div>
        ) : (
          <div className="cachet-back__empty">{emptyNote ?? 'No signed statement published.'}</div>
        )}
      </div>

      <footer className="cachet__foot cachet-back__foot">
        <dl className="cachet-back__sigs">
          {BACK_SIGS.map(({ key, label, title }) => {
            const value = sigs[key];
            return (
              <div key={key} title={value ? `${title}\n${value}` : title}>
                <dt>{label}</dt>
                <dd className="cachet__mono">
                  {value ? shortMiddle(value, 8, 6) : loading ? <span className="c-skel" style={{ width: 84, height: 10 }} /> : '—'}
                </dd>
              </div>
            );
          })}
        </dl>
        <svg className="cachet-back__hallmark" width="30" height="20" viewBox="0 0 30 20" aria-hidden>
          <path className="cachet-back__hallmark-lens" d="M15 3.25A7.6 7.6 0 0 1 15 16.75A7.6 7.6 0 0 1 15 3.25Z" />
          <circle cx="11.5" cy="10" r="7.6" />
          <circle cx="18.5" cy="10" r="7.6" />
        </svg>
      </footer>
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
