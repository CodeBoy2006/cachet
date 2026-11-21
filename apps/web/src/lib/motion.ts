/** True when the visitor asked the OS for less motion. Safe to call during render and in tests. */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
