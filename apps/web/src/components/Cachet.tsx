import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { npubEncode, type Check, type CheckId } from '@cachet/core';
import { Avatar, CopyIcon, IconCheck, IconX, formatDate, shortMiddle } from '@cachet/react';
import { CURVE_MICROPRINT, axisTicks, bchPoint, curvePaths, nostrPoint, yAxisX, type CurvePoint } from '../lib/curve.ts';
import { BECH32, HEX_UPPER, prefersReducedMotion, useScramble } from '../lib/useScramble.ts';
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
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
const TAU = Math.PI * 2;
const f = (n: number) => (Math.round(n * 100) / 100).toString();

const groupSerial = (hex: string) =>
  hex
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1 ');

/** Arc from angle a to b (degrees, SVG orientation: 0° = 3 o'clock, 90° = 6 o'clock). */
const arc = (r: number, a: number, b: number) => {
  const p = (deg: number) => `${f(r * Math.cos((deg * Math.PI) / 180))} ${f(r * Math.sin((deg * Math.PI) / 180))}`;
  return `M${p(a)}A${r} ${r} 0 0 ${b > a ? 1 : 0} ${p(b)}`;
};

const star = (cx: number) =>
  `M${cx} -2.4L${cx + 0.55} -0.55L${cx + 2.4} 0L${cx + 0.55} 0.55L${cx} 2.4L${cx - 0.55} 0.55L${cx - 2.4} 0L${cx - 0.55} -0.55Z`;

const BEADS = Array.from({ length: 84 }, (_, i) => {
  const a = (i / 84) * TAU;
  return { x: f(Math.cos(a) * 61.5), y: f(Math.sin(a) * 61.5) };
});

const GAP = 11;
const TOP_R = 51.9;
const BOTTOM_R = 55.3;
const TOP_ARC = arc(TOP_R, 180 + GAP, 360 - GAP);
const BOTTOM_ARC = arc(BOTTOM_R, 180 - GAP, GAP);
const arcLength = (r: number) => (r * (180 - 2 * GAP) * Math.PI) / 180;

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
  back?: ReactNode;
}

const Point = ({ at, kind, label, signed }: { at?: CurvePoint; kind: 'p' | 'q'; label: string; signed: boolean }) =>
  at ? (
    <g className={`seal__pt seal__pt--${kind}`} data-signed={signed || undefined} style={{ transform: `translate(${f(at.X)}px, ${f(at.Y)}px)` }}>
      <circle className="seal__pt-halo" r={4.6} />
      <circle className="seal__pt-dot" r={2.1} />
      <text className="seal__pt-label" x={kind === 'p' ? -3.8 : 3.8} y={at.Y < 0 ? -3.4 : 7.6} textAnchor={kind === 'p' ? 'end' : 'start'}>
        {label}
      </text>
    </g>
  ) : null;

/**
 * An embossed seal. The ring carries the two lineages in full — the title of the 2008
 * Bitcoin paper and Nostr's own name — around the curve both keys live on.
 */
const Seal = ({
  uid,
  stage,
  verdict,
  focus,
  p,
  q,
}: {
  uid: string;
  stage: CachetStage;
  verdict: CachetVerdict;
  focus?: CachetZone;
  p?: CurvePoint;
  q?: CurvePoint;
}) => {
  const { up, down } = useMemo(curvePaths, []);
  const ticks = useMemo(axisTicks, []);
  const sealed = stage === 'sealed';
  const voided = sealed && verdict === 'void';
  const inked = !(sealed && verdict === 'muted');
  const keys = reached(stage, 'keys');

  return (
    <svg viewBox="-66 -66 132 132" className="seal" aria-hidden>
      <defs>
        <path id={`${uid}-top`} d={TOP_ARC} />
        <path id={`${uid}-bot`} d={BOTTOM_ARC} />
        <clipPath id={`${uid}-disc`}>
          <circle r={45.6} />
        </clipPath>
      </defs>
      <circle className="seal__face" r={64.6} />
      <g className="seal__beads">
        {BEADS.map((b) => (
          <circle key={`${b.x},${b.y}`} cx={b.x} cy={b.y} r={0.62} />
        ))}
      </g>
      <circle className="seal__rule" r={58.7} />
      <circle className="seal__rule" r={48.6} />
      <circle className="seal__rule seal__rule--fine" r={47} />
      <g className="seal__ring">
        <text className="seal__legend seal__legend--bch">
          <textPath href={`#${uid}-top`} startOffset="50%" textAnchor="middle" textLength={arcLength(TOP_R) - 2} lengthAdjust="spacing">
            BITCOIN: A PEER-TO-PEER ELECTRONIC CASH SYSTEM
          </textPath>
        </text>
        <text className="seal__legend seal__legend--nostr">
          <textPath href={`#${uid}-bot`} startOffset="50%" textAnchor="middle" textLength={arcLength(BOTTOM_R) - 2} lengthAdjust="spacing">
            NOSTR: NOTES AND OTHER STUFF TRANSMITTED BY RELAYS
          </textPath>
        </text>
        <path className="seal__star" d={star(-53.6)} />
        <path className="seal__star" d={star(53.6)} />
      </g>

      <g clipPath={`url(#${uid}-disc)`}>
        <g className="seal__axes">
          <path d={`M-46 0H46M${f(yAxisX)} -46V46`} />
          {ticks.map((x) => (
            <path key={x} d={`M${f(x)} -1.4V1.4`} />
          ))}
        </g>
        {keys && (
          <g className="seal__curve">
            <path d={up} pathLength={1} />
            <path d={down} pathLength={1} />
          </g>
        )}
        {focus === 'seal' && p && q && (
          <g className="seal__proj">
            <path d={`M${f(p.X)} ${f(p.Y)}V0`} />
            <path d={`M${f(q.X)} ${f(q.Y)}V0`} />
          </g>
        )}
        {sealed && verdict !== 'muted' && p && q && (
          <line key={`${voided}`} className="seal__chord" pathLength={1} x1={f(p.X)} y1={f(p.Y)} x2={f(q.X)} y2={f(q.Y)} />
        )}
        <Point at={keys ? q : undefined} kind="q" label={voided ? 'Q′' : 'Q'} signed={inked && reached(stage, 'bch')} />
        <Point at={keys ? p : undefined} kind="p" label="P" signed={inked && reached(stage, 'nostr')} />
      </g>
    </svg>
  );
};

const Overprint = ({ text, uid }: { text: string; uid: string }) => (
  <svg className="cachet__overprint" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid meet" aria-hidden>
    <defs>
      <pattern id={`${uid}-hatch`} width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="4.5" />
      </pattern>
    </defs>
    <text
      x="300"
      y="156"
      textAnchor="middle"
      dominantBaseline="middle"
      fill={`url(#${uid}-hatch)`}
      transform="rotate(-9 300 150)"
      style={{ fontSize: Math.min(150, 540 / (text.length * 0.66)) }}
    >
      {text}
    </text>
  </svg>
);

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

/** The secp256k1 domain parameters, set as a microprinted rule. */
const Microprint = () => (
  <svg className="cachet__micro" viewBox="0 0 600 6" preserveAspectRatio="xMinYMid slice" aria-hidden>
    <text x="0" y="4.3">
      {CURVE_MICROPRINT.repeat(2)}
    </text>
  </svg>
);

/**
 * A certificate for one binding: two keys, two lineages, one curve. Each identity sits at its
 * own pair of points on y² = x³ + 7 and carries its binding ID as a serial number.
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
  back,
}: CachetProps) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const npub = pubkey ? npubEncode(pubkey) : '';
  const [prefix = '', body = ''] = cashaddr ? cashaddr.split(':') : [];
  const sealed = stage === 'sealed';
  const hasKeys = reached(stage, 'keys');
  // A withdrawn, expired or missing link carries no live signatures.
  const inked = !(sealed && verdict === 'muted');
  const bchSigned = inked && reached(stage, 'bch');
  const nostrSigned = inked && reached(stage, 'nostr');

  const npubTarget = hasKeys && npub ? shortMiddle(npub.slice(5), 4, 4) : '';
  const addrTarget = hasKeys && body ? shortMiddle(body, 7, 6) : '';
  const sealedAddr = sealedCashaddr ? shortMiddle(sealedCashaddr.split(':')[1] ?? '', 7, 6) : undefined;
  const npubText = useScramble(npubTarget, { charset: BECH32, duration: 560 });
  const addrText = useScramble(addrTarget, { charset: BECH32, duration: 560, delay: 90 });
  const serialText = useScramble(sealed && serial ? groupSerial(serial) : '', { charset: HEX_UPPER, duration: 640 });

  const p = useMemo(() => (pubkey ? nostrPoint(pubkey) : undefined), [pubkey]);
  const q = useMemo(() => bchPoint(bchKey), [bchKey]);

  // Sealing is a moment: replay the press whenever the card is (re)sealed.
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

  return (
    <div
      ref={ref}
      className="cachet"
      data-stage={stage}
      data-verdict={sealed ? verdict : undefined}
      data-focus={focus}
      data-flipped={flipped || undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="cachet__flip">
        <article className="cachet__face cachet__face--front" aria-label="Identity" inert={flipped || undefined}>
          <span className="cachet__frame" aria-hidden />

          <header className="cachet__head">
            <span className="cachet__title">BCH · Nostr binding</span>
            <span className="cachet__serial" data-zone="statement" title="Binding ID: SHA-256 of the signed statement">
              <span className="cachet__no">№</span>
              <span className="cachet__serial-v">{serialText || '···· ···· ···· ····'}</span>
            </span>
          </header>

          <div className="cachet__body">
            <div className="cachet__side cachet__side--nostr" data-zone="nostr">
              <div className="cachet__kicker">
                <span className="c-dot" style={{ background: 'var(--dot-nostr)' }} />
                Nostr
              </div>
              {npubTarget ? (
                <>
                  <div className="cachet__main">
                    {name ? (
                      <span className="cachet__name" title={name}>
                        {name}
                      </span>
                    ) : (
                      <span className="cachet__addr cachet__mono">npub1{npubText}</span>
                    )}
                  </div>
                  <div className="cachet__value">
                    <Avatar pubkey={pubkey} picture={picture} size={16} />
                    <span className="cachet__mono">{name ? `npub1${npubText}` : 'npub'}</span>
                    <CopyIcon value={npub} title="Copy npub" />
                  </div>
                </>
              ) : (
                <>
                  <div className="cachet__main">
                    <span className="c-skel" style={{ width: 132 }} />
                  </div>
                  <div className="cachet__value">
                    <span className="c-skel" style={{ width: 96 }} />
                  </div>
                </>
              )}
              <div className="cachet__scheme" data-on={nostrSigned || undefined}>
                <IconCheck size={11} strokeWidth={2.2} />
                Schnorr · BIP-340
              </div>
            </div>

            <figure className="cachet__seal" data-zone="seal">
              <div className="cachet__seal-disc">
                <Seal uid={uid} stage={stage} verdict={verdict} focus={focus} p={p} q={q} />
                {sealed && <span key={pressKey} className="cachet__press" aria-hidden />}
              </div>
              <figcaption className="cachet__eq">
                <i>y</i>² = <i>x</i>³ + 7
              </figcaption>
            </figure>

            <div className="cachet__side cachet__side--bch" data-zone="bch">
              <div className="cachet__kicker">
                {tokenAware && <span className="c-tag">CashTokens</span>}
                Bitcoin Cash
                <span className="c-dot" style={{ background: 'var(--dot-bch)' }} />
              </div>
              {addrTarget ? (
                <>
                  <div className="cachet__main">
                    <span className="cachet__addr cachet__mono" title={cashaddr}>
                      <Diff shown={addrText} target={addrTarget} sealed={sealedAddr} />
                    </span>
                  </div>
                  <div className="cachet__value">
                    <span className="cachet__mono">{prefix}</span>
                    <CopyIcon value={cashaddr!} title="Copy address" />
                  </div>
                </>
              ) : (
                <>
                  <div className="cachet__main">
                    <span className="c-skel" style={{ width: 128 }} />
                  </div>
                  <div className="cachet__value">
                    <span className="c-skel" style={{ width: 80 }} />
                  </div>
                </>
              )}
              <div className="cachet__scheme" data-on={bchSigned || undefined}>
                ECDSA · Signed Message
                {sealed && verdict === 'void' ? <IconX size={10} strokeWidth={2.4} /> : <IconCheck size={11} strokeWidth={2.2} />}
              </div>
            </div>
          </div>

          <Microprint />

          <footer className="cachet__foot">
            <span className="cachet__status">{status}</span>
            {expiresAt && (
              <span className="cachet__expiry" data-zone="time">
                Valid until {formatDate(expiresAt)}
              </span>
            )}
          </footer>

          <span className="cachet__glare" aria-hidden />
          {sealed && verdict === 'valid' && <span key={`s${pressKey}`} className="cachet__sweep" aria-hidden />}
          {sealed && overprint && <Overprint key={overprint} text={overprint} uid={uid} />}
        </article>

        <section className="cachet__face cachet__face--back" aria-label="Signed statement" inert={!flipped || undefined}>
          {back}
        </section>
      </div>
    </div>
  );
};

/** The back of the card: the exact text the BCH wallet signed, and both signatures. */
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
      <span className="cachet__frame" aria-hidden />
      <header className="cachet__head">
        <span className="cachet__title">Signed message</span>
        <span className="cachet__title cachet-back__size">
          {message.length} bytes
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
      <p className="cachet-back__frame">
        Hashed as SHA-256d(<span className="cachet__mono">"\x18Bitcoin Signed Message:\n"</span> ‖ length ‖ message)
      </p>
      <dl className="cachet-back__rows">
        <div>
          <dt>BCH signature</dt>
          <dd className="cachet__mono" title={bchSig}>
            {bchSig}
          </dd>
        </div>
        <div>
          <dt>Nostr event</dt>
          <dd className="cachet__mono" title={eventId}>
            {eventId}
          </dd>
        </div>
        <div>
          <dt>Schnorr signature</dt>
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

/** The verification slip under the card. Rows resolve one by one. */
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
              {status === 'pass' && <IconCheck size={12} strokeWidth={2.3} />}
              {status === 'fail' && <IconX size={11} strokeWidth={2.4} />}
            </span>
            <span className="ledger__label">
              {c.label}
              {status === 'fail' && c.code && <span className="ledger__code">{c.code}</span>}
            </span>
            <span className="ledger__dots" aria-hidden />
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
  // Ignore state left over from a previous run until the effect resets it.
  return state.run === run ? state : { shown: 0, done: false, run };
};
