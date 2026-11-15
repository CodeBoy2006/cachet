import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 16, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
});

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8.4 6.5 11.2 12.5 4.8" />
  </svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
);
export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.2l2 1.3" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.75" />
    <path d="M10.75 5.25V4.5a1.25 1.25 0 0 0-1.25-1.25H4.5A1.25 1.25 0 0 0 3.25 4.5v5a1.25 1.25 0 0 0 1.25 1.25h.75" />
  </svg>
);
export const IconArrowUpRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 11 11 5M6 5h5v5" />
  </svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 6.5 3 3 3-3" />
  </svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.75 8A4.75 4.75 0 1 1 11.3 4.6" />
    <path d="M12.75 3.25V5.5H10.5" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2.75v7.5M5 7.5l3 3 3-3M3.25 13.25h9.5" />
  </svg>
);
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 7.25v3.5M8 5.2v.1" />
  </svg>
);
export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2.75 13.5 12.5h-11L8 2.75Z" />
    <path d="M8 6.75v2.5M8 11v.1" />
  </svg>
);
export const IconKey = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="10.5" r="2.75" />
    <path d="m7.5 8.5 5.25-5.25M10.75 5.25l1.5 1.5" />
  </svg>
);
export const IconWallet = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.25" y="4" width="11.5" height="9" rx="2" />
    <path d="M2.25 6.5h11.5M10.5 9.75h.5" />
  </svg>
);
export const IconPen = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.25 3.25 12.75 5.75 6 12.5 3.25 12.75 3.5 10 10.25 3.25Z" />
  </svg>
);
export const IconPuzzle = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3.25h4v2a1.25 1.25 0 1 0 2.5 0v-.5M3.25 6v4h2a1.25 1.25 0 1 1 0 2.5h-.5" />
    <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="2" />
  </svg>
);
export const IconBeaker = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2.75v4L3.25 12a1 1 0 0 0 .9 1.25h7.7a1 1 0 0 0 .9-1.25L10 6.75v-4M5 2.75h6M4.75 10h6.5" />
  </svg>
);
export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="7.25" cy="7.25" r="4.25" />
    <path d="m10.5 10.5 2.75 2.75" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);
export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </svg>
);
export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12.75 9.6A5.25 5.25 0 0 1 6.4 3.25a5.25 5.25 0 1 0 6.35 6.35Z" />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.75" />
    <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" />
  </svg>
);
