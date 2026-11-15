import { useEffect, useMemo, useRef, useState } from 'react';
import { VERIFY_CODES, verifyBinding } from '@cachet/core';
import { CheckList, IconCheck, IconRefresh, IconUndo, IconX, Note } from '@cachet/react';
import { SCENARIOS, type Built } from '../lib/scenarios.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export const Lab = () => {
  const [active, setActive] = useState(SCENARIOS[1]!.id);
  const [built, setBuilt] = useState<Built>();
  const [text, setText] = useState('');
  const [seed, setSeed] = useState(0);
  const nav = useRef<HTMLElement>(null);
  const scenario = SCENARIOS.find((s) => s.id === active)!;
  usePageTitle('Lab');

  useEffect(() => {
    let live = true;
    void scenario.build().then((b) => {
      if (!live) return;
      setBuilt(b);
      setText(pretty(b.event));
    });
    return () => {
      live = false;
    };
  }, [scenario, seed]);

  // Keep the chosen case in view inside the list (sideways on phones, vertical on desktop) without moving the page.
  const firstScroll = useRef(true);
  useEffect(() => {
    const list = nav.current;
    const el = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !el) return;
    const behavior = firstScroll.current ? 'auto' : 'smooth';
    firstScroll.current = false;
    const a = list.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (list.scrollWidth > list.clientWidth) {
      list.scrollTo({ left: list.scrollLeft + b.left - a.left - (a.width - b.width) / 2, behavior });
    } else if (list.scrollHeight > list.clientHeight && (b.top < a.top || b.bottom > a.bottom)) {
      list.scrollTo({ top: list.scrollTop + b.top - a.top - (a.height - b.height) / 2, behavior });
    }
  }, [active]);

  // The editor is the source of truth: what you see is exactly what gets verified.
  const result = useMemo(() => (built ? verifyBinding(text, { now: built.now }) : undefined), [text, built]);
  const original = built ? pretty(built.event) : '';
  const edited = !!built && text !== original;
  const matches = result && (result.code === scenario.expect || (scenario.expect === 'ok' && result.ok));

  const choose = (id: string) => {
    setActive(id);
    setSeed((x) => x + 1);
  };

  const onNavKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = SCENARIOS.findIndex((s) => s.id === active);
    const next = SCENARIOS[(i + step + SCENARIOS.length) % SCENARIOS.length]!;
    choose(next.id);
    requestAnimationFrame(() => nav.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus());
  };

  return (
    <div className="wrap page">
      <div className="page-head">
        <h1>Lab</h1>
        <p>Each case is built in your browser with throwaway keys and checked by the same verifier wallets and apps use. Edit the event to try your own.</p>
      </div>
      <div className="lab">
        <nav ref={nav} className="scenarios" aria-label="Scenarios" onKeyDown={onNavKey}>
          {SCENARIOS.map((s, i) => (
            <button key={s.id} data-id={s.id} type="button" className="scenario" aria-pressed={s.id === active} onClick={() => choose(s.id)}>
              <span className="scenario__n mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="scenario__text">
                <strong>{s.title}</strong>
                <small>{s.blurb}</small>
                <span className="scenario__expect mono" data-ok={s.expect === 'ok'}>
                  {s.expect === 'ok' ? 'valid' : s.expect}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <section className="c-card lab__result" aria-live="polite">
          {result ? (
            <>
              <div className="verdict" data-ok={result.ok} key={`${active}-${seed}-${result.ok}`}>
                <span className="verdict__mark">{result.ok ? <IconCheck size={20} strokeWidth={2.2} /> : <IconX size={18} strokeWidth={2.2} />}</span>
                <div className="verdict__text">
                  <h2>{result.ok ? 'Valid binding' : VERIFY_CODES[result.code]}</h2>
                  <p>
                    {result.ok ? 'All checks pass.' : <code>{result.code}</code>}
                    {!edited && matches && <span className="muted"> · as expected</span>}
                    {edited && <span className="muted"> · edited by you</span>}
                  </p>
                </div>
                <div className="verdict__actions">
                  {edited && (
                    <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setText(original)} title="Undo your edits">
                      <IconUndo size={14} /> Reset
                    </button>
                  )}
                  <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={() => setSeed((x) => x + 1)} title="Rebuild with fresh keys">
                    <IconRefresh size={14} /> New keys
                  </button>
                </div>
              </div>
              <div className="lab__checks">
                {built?.aside && !edited && <Note>{built.aside}</Note>}
                <CheckList key={`${active}-${seed}-${result.code}`} checks={result.checks} />
              </div>
            </>
          ) : (
            <div className="lab__loading" aria-hidden>
              <span className="c-skel" style={{ width: '46%', height: 18 }} />
              <span className="c-skel" style={{ width: '28%' }} />
            </div>
          )}
          <label htmlFor="event-json" className="lab__editor-label">
            <span>Event JSON</span>
            {edited && <span className="lab__edited">edited</span>}
          </label>
          <textarea id="event-json" className="lab__editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </section>
      </div>
    </div>
  );
};
