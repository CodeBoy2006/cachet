import { IconCheck, IconLink, useCopy } from '@cachet/react';

/** Native share sheet on phones, copy-to-clipboard elsewhere. */
export const ShareButton = ({ url, title, label = 'Copy link' }: { url: string; title: string; label?: string }) => {
  const { copied, copy } = useCopy();
  const share = async () => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await copy(url);
  };
  return (
    <button type="button" className="c-btn c-btn--ghost c-btn--sm share-btn" data-copied={copied} onClick={share}>
      {copied ? <IconCheck size={14} /> : <IconLink size={14} />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
};
