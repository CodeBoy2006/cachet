import { VERIFY_CODES, type Check } from '@cachet/core';
import { IconCheck, IconX } from './icons.tsx';

export const CheckList = ({ checks, stagger = 45 }: { checks: Check[]; stagger?: number }) => (
  <ul className="c-checks">
    {checks.map((c, i) => (
      <li key={c.id} className="c-check" data-status={c.status} style={{ animationDelay: `${i * stagger}ms` }}>
        <span className="c-check__mark" aria-label={c.status}>
          {c.status === 'pass' && <IconCheck size={12} strokeWidth={2.2} />}
          {c.status === 'fail' && <IconX size={11} strokeWidth={2.2} />}
        </span>
        <span className="c-check__label">
          {c.label}
          {c.status === 'fail' && c.code && (
            <span className="c-check__code">
              {c.code} · {VERIFY_CODES[c.code]}
            </span>
          )}
        </span>
        <span className="c-check__detail" title={c.detail}>
          {c.status === 'skip' ? 'not reached' : c.detail ?? ''}
        </span>
      </li>
    ))}
  </ul>
);
