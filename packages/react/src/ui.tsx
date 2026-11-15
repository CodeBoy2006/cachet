import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { STATE_LABELS, type BindingState } from '@cachet/core';
import { IconAlert, IconCheck, IconCopy, IconInfo, IconX } from './icons.tsx';
import { avatarGradient } from './format.ts';

export const Logo = ({ size = 22, verified = true }: { size?: number; verified?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="9" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="15" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M12 6.234A6.5 6.5 0 0 1 12 17.766A6.5 6.5 0 0 1 12 6.234Z"
      fill={verified ? 'var(--accent)' : 'currentColor'}
      stroke="none"
    />
  </svg>
);

export const Wordmark = ({ size = 22 }: { size?: number }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, letterSpacing: '-0.02em', fontSize: size * 0.8 }}>
    <Logo size={size} />
    cachet
  </span>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => <span className="c-spinner" role="status" aria-label={label} />;

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some embedded webviews block the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
};

export const useCopy = (timeout = 1400) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    if (!(await copyText(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), timeout);
  };
  return { copied, copy };
};

export const CopyChip = ({ value, label, title }: { value: string; label?: ReactNode; title?: string }) => {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className="c-copy" data-copied={copied} onClick={() => copy(value)} title={title ?? 'Copy'}>
      <span>{label ?? value}</span>
      <span className="c-copy__icon" aria-hidden>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
};

export const CopyIcon = ({ value, title = 'Copy' }: { value: string; title?: string }) => {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className="c-icon-btn c-copy-icon" data-copied={copied} onClick={() => copy(value)} title={copied ? 'Copied' : title} aria-label={title}>
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
};

export const StatePill = ({ state, label }: { state: BindingState | 'loading'; label?: string }) => (
  <span className={`c-pill c-pill--${state}`}>{label ?? (state === 'loading' ? 'Checking relays' : STATE_LABELS[state])}</span>
);

export const Avatar = ({ pubkey, picture, size = 40 }: { pubkey?: string; picture?: string; size?: number }) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [picture]);
  const style = { width: size, height: size };
  if (picture && !broken) {
    return <img className="c-avatar" style={style} src={picture} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className="c-avatar" style={{ ...style, background: pubkey ? avatarGradient(pubkey) : undefined }} />;
};

export const Note = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) => (
  <div className={`c-note${tone === 'info' ? '' : ` c-note--${tone}`}`} role={tone === 'danger' ? 'alert' : undefined}>
    {tone === 'ok' ? <IconCheck /> : tone === 'info' ? <IconInfo /> : <IconAlert />}
    <div>{children}</div>
  </div>
);

/** A single-choice control. Behaves as a radio group: arrow keys move the choice, Tab leaves it. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number }>();
  const index = options.findIndex((o) => o.value === value);

  // The thumb slides under the chosen option; measured, so labels of any width work.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const btn = el.querySelectorAll<HTMLButtonElement>('button')[index];
      setThumb(btn ? { x: btn.offsetLeft, w: btn.offsetWidth } : undefined);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, options.length]);

  const onKey = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    const next = options[(Math.max(index, 0) + step + options.length) % options.length]!;
    onChange(next.value);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };

  return (
    <div ref={root} className={`c-seg${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} onKeyDown={onKey}>
      {thumb && <span className="c-seg__thumb" aria-hidden style={{ width: thumb.w, translate: `${thumb.x}px 0` }} />}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === Math.max(index, 0) ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Open dialogs, innermost last: only the top one answers Escape. */
const dialogStack: string[] = [];
const EXIT_MS = 150;

export const Dialog = ({
  open,
  title,
  onClose,
  children,
  width,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) => {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [mounted, setMounted] = useState(open);
  // While the exit animation runs, keep showing what was there, not whatever the parent reset to.
  const frozen = useRef<{ title: string; children: ReactNode }>({ title, children });
  if (open) frozen.current = { title, children };

  useEffect(() => {
    if (open) return setMounted(true);
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogStack.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [
        ...ref.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = dialogStack.lastIndexOf(id);
      if (at >= 0) dialogStack.splice(at, 1);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, id]);

  if (!open && !mounted) return null;
  const shown = open ? { title, children } : frozen.current;
  // Portalled to <body>: an ancestor with a transform or overflow would otherwise clip the fixed backdrop.
  return createPortal(
    <div className="c-dialog-backdrop" data-closing={!open || undefined} onMouseDown={(e) => open && e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        className="c-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <div className="c-dialog__head">
          <h2 className="c-dialog__title" id={`${id}-title`}>
            {shown.title}
          </h2>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close" disabled={!open}>
            <IconX />
          </button>
        </div>
        <div className="c-dialog__body">{shown.children}</div>
      </div>
    </div>,
    document.body,
  );
};

/** A small inline confirmation: one button, then "Are you sure?" with the real action. No native confirm(). */
export const ConfirmButton = ({
  children,
  confirmLabel,
  prompt,
  onConfirm,
  className = 'c-btn c-btn--danger',
}: {
  children: ReactNode;
  confirmLabel: ReactNode;
  prompt: ReactNode;
  onConfirm: () => void;
  className?: string;
}) => {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <div className="c-confirm" role="group">
      <span>{prompt}</span>
      <span className="c-confirm__actions">
        <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setAsking(false)} autoFocus>
          Cancel
        </button>
        <button type="button" className="c-btn c-btn--danger-solid c-btn--sm" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </span>
    </div>
  );
};
