import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Always dark-on-white, whatever the theme: scanners need contrast. */
export const Qr = ({ value, size = 200, label }: { value: string; size?: number; label?: string }) => {
  const rendered = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return { path: d, count: n };
    } catch {
      return null;
    }
  }, [value]);
  if (!rendered) return null;
  const { path, count } = rendered;
  const quiet = 4;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      role="img"
      aria-label={label ?? 'QR code'}
      shapeRendering="crispEdges"
      style={{ background: '#fff', borderRadius: 12, display: 'block' }}
    >
      <path d={path} fill="#111" />
    </svg>
  );
};
