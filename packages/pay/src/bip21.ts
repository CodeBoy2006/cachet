export const SATS_PER_BCH = 100_000_000n;

/** 123456n → "0.00123456" with trailing zeros trimmed. No floating point. */
export const formatBch = (sats: bigint, opts: { trim?: boolean } = {}): string => {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / SATS_PER_BCH;
  let frac = (abs % SATS_PER_BCH).toString().padStart(8, '0');
  if (opts.trim !== false) frac = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
};

/** "0.001" → 100000n. Rejects more than 8 decimals and anything non-numeric. */
export const parseBch = (value: string): bigint | null => {
  const m = /^(\d{1,8})(?:\.(\d{0,8}))?$/.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1]!) * SATS_PER_BCH + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
};

export const paymentUri = (cashaddr: string, opts: { sats?: bigint; label?: string; message?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.sats && opts.sats > 0n) q.set('amount', formatBch(opts.sats));
  if (opts.label) q.set('label', opts.label);
  if (opts.message) q.set('message', opts.message);
  const query = q.toString().replace(/\+/g, '%20');
  return query ? `${cashaddr}?${query}` : cashaddr;
};
