import { useEffect, useMemo, useState } from 'react';
import { VERIFY_CODES, verifyBinding } from '@cachet/core';
import { CheckList, IconCheck, IconRefresh, IconX, Note } from '@cachet/react';
import { SCENARIOS, type Built } from '../lib/scenarios.ts';

export const Lab = () => {
  const [active, setActive] = useState(SCENARIOS[1]!.id);
  const [built, setBuilt] = useState<Built>();
  const [text, setText] = useState('');
  const [seed, setSeed] = useState(0);
  const scenario = SCENARIOS.find((s) => s.id === active)!;

  useEffect(() => {
    let live = true;
    void scenario.build().then((b) => {
      if (!live) return;
      setBuilt(b);
      setText(JSON.stringify(b.event, null, 2));
    });
    return () => {
      live = false;
    };
  }, [scenario, seed]);

  const result = useMemo(() => {
    if (!built) return undefined;
    // The editor is the source of truth once the user types; same verifier either way.
    return verifyBinding(text || built.event, { now: built.now });
  }, [text, built]);

  const edited = built && text !== JSON.stringify(built.event, null, 2);
  const matches = result && (result.code === scenario.expect || (scenario.expect === 'ok' && result.ok));

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Lab</h1>
        <p>Each case is built in your browser with throwaway keys and checked by the same verifier wallets and apps use. Edit the event to try your own.</p>
      </div>
      <div className="lab">
        <nav className="scenarios" aria-label="Scenarios">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className="scenario" aria-pressed={s.id === active} onClick={() => (setActive(s.id), setSeed((x) => x + 1))}>
              <strong>
                {s.title}
                <span className="expect">{s.expect === 'ok' ? 'valid' : s.expect}</span>
              </strong>
              <small>{s.blurb}</small>
            </button>
          ))}
        </nav>
        <section className="c-card" aria-live="polite">
          {result && (
            <>
              <div className="verdict" data-ok={result.ok}>
                <span className="verdict__mark">{result.ok ? <IconCheck size={20} strokeWidth={2.2} /> : <IconX size={18} strokeWidth={2.2} />}</span>
                <div style={{ minWidth: 0 }}>
                  <h2>{result.ok ? 'Valid binding' : VERIFY_CODES[result.code]}</h2>
                  <p>
                    {result.ok ? 'All checks pass.' : <code>{result.code}</code>}
                    {!edited && matches && <span className="muted"> · as expected</span>}
                    {edited && <span className="muted"> · edited by you</span>}
                  </p>
                </div>
                <button type="button" className="c-btn c-btn--ghost c-btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setSeed((x) => x + 1)} title="Rebuild with fresh keys">
                  <IconRefresh size={14} /> New keys
                </button>
              </div>
              <div style={{ padding: '10px 22px 18px' }}>
                {built?.aside && !edited && (
                  <div style={{ margin: '6px 0 12px' }}>
                    <Note>{built.aside}</Note>
                  </div>
                )}
                <CheckList key={`${active}-${seed}-${result.code}`} checks={result.checks} />
              </div>
            </>
          )}
          <label htmlFor="event-json" className="sr-only" style={{ position: 'absolute', left: -9999 }}>
            Event JSON
          </label>
          <textarea id="event-json" className="lab__editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </section>
      </div>
    </div>
  );
};
