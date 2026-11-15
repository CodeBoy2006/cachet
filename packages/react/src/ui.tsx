import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export const Spinner = () => <span className="c-spinner" role="status" aria-label="Loading" />;

export const useCopy = (timeout = 1400) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
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
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
};

export const CopyIcon = ({ value, title = 'Copy' }: { value: string; title?: string }) => {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className="c-icon-btn" onClick={() => copy(value)} title={title} aria-label={title}>
      {copied ? <IconCheck size={14} style={{ color: 'var(--accent)' }} /> : <IconCopy size={14} />}
    </button>
  );
};

export const StatePill = ({ state, label }: { state: BindingState | 'loading'; label?: string }) => (
  <span className={`c-pill c-pill--${state}`}>{label ?? (state === 'loading' ? 'Checking relays' : STATE_LABELS[state])}</span>
);

export const Avatar = ({ pubkey, picture, size = 40 }: { pubkey?: string; picture?: string; size?: number }) => {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (picture && !broken) {
    return <img className="c-avatar" style={style} src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="c-avatar" style={{ ...style, background: pubkey ? avatarGradient(pubkey) : undefined }} />;
};

export const Note = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) => (
  <div className={`c-note${tone === 'info' ? '' : ` c-note--${tone}`}`} role={tone === 'danger' ? 'alert' : undefined}>
    {tone === 'ok' ? <IconCheck /> : tone === 'info' ? <IconInfo /> : <IconAlert />}
    <div>{children}</div>
  </div>
);

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="c-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')];
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
      document.body.style.overflow = prev;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="c-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="c-dialog" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="c-dialog__head">
          <h2 className="c-dialog__title">{title}</h2>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="c-dialog__body">{children}</div>
      </div>
    </div>
  );
};
