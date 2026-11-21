import { useEffect, useMemo, useRef, useState } from 'react';
import { finalizeEvent } from 'nostr-tools/pure';
import { VERIFY_CODES, canonicalize, verifyBinding } from '@cachet/core';
import { LocalBchSigner } from '@cachet/signers';
import { CheckList, CopyIcon, IconCheck, IconPlay, IconRefresh, IconUndo, IconX, Note, Spinner } from '@cachet/react';
import { SCENARIOS, type Built } from '../lib/scenarios.ts';
import { usePageTitle } from '../lib/usePageTitle.ts';
import { prefersReducedMotion, wait } from '../lib/motion.ts';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

interface AuditEntry {
  ok: boolean;
  matched: boolean;
  ms: number;
}

export const Lab = () => {
  const [active, setActive] = useState(SCENARIOS[1]!.id);
  const [built, setBuilt] = useState<Built>();
  const [text, setText] = useState('');
  const [tamperNote, setTamperNote] = useState<string>();
  const [seed, setSeed] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const [audit, setAudit] = useState<Record<string, AuditEntry>>({});
  const sweepAbort = useRef(0);
  const nav = useRef<HTMLElement>(null);
  const scenario = SCENARIOS.find((s) => s.id === active)!;
  usePageTitle('Lab');

  useEffect(() => () => {
    sweepAbort.current++;
  }, []);

  useEffect(() => {
    if (sweeping) return;
    let live = true;
    setTamperNote(undefined);
    void scenario.build().then((b) => {
      if (!live) return;
      setBuilt(b);
      setText(pretty(b.event));
    });
    return () => {
      live = false;
    };
  }, [scenario, seed, sweeping]);

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
    if (sweeping) {
      sweepAbort.current++;
      setSweeping(false);
    }
    setActive(id);
    setSeed((x) => x + 1);
  };

  const runAllCases = async () => {
    const runId = ++sweepAbort.current;
    setSweeping(true);
    setAudit({});
    setTamperNote(undefined);
    const fast = prefersReducedMotion();

    for (const s of SCENARIOS) {
      if (sweepAbort.current !== runId) return;
      const b = await s.build();
      if (sweepAbort.current !== runId) return;
      const raw = pretty(b.event);
      const t0 = performance.now();
      const r = verifyBinding(raw, { now: b.now });
      const ms = Math.max(0.1, performance.now() - t0);
      const matched = r.code === s.expect || (s.expect === 'ok' && r.ok);

      setActive(s.id);
      setBuilt(b);
      setText(raw);
      setAudit((prev) => ({ ...prev, [s.id]: { ok: r.ok, matched, ms } }));

      if (!fast) await wait(95);
    }

    if (sweepAbort.current !== runId) return;
    const target = SCENARIOS[0]!;
    const finalBuilt = await target.build();
    if (sweepAbort.current !== runId) return;
    setActive(target.id);
    setBuilt(finalBuilt);
    setText(pretty(finalBuilt.event));
    setSweeping(false);
  };

  const tamperAddress = () => {
    const replacement = LocalBchSigner.generate().address();
    if (built?.secret && built.proof) {
      const forgedProof = { ...built.proof, statement: { ...built.proof.statement, cashaddr: replacement } };
      const forgedEvent = finalizeEvent(
        { kind: 10011, created_at: built.now - 25, tags: [['i', `bch:${replacement}`, canonicalize(forgedProof)]], content: '' },
        built.secret,
      );
      setText(pretty(forgedEvent));
      setTamperNote('swapped CashAddr · re-signed Nostr');
      return;
    }
    const match = /bitcoincash:[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{42}/i.exec(text);
    if (match) {
      setText(text.replaceAll(match[0], replacement));
      setTamperNote('swapped CashAddr');
      return;
    }
    tamperSig();
  };

  const tamperSig = () => {
    setText(text.replace(/"sig":\s*"([0-9a-f])/, (_, c: string) => `"sig": "${c === '0' ? '1' : '0'}`));
    setTamperNote('flipped 1 sig nibble');
  };

  const tamperCanonical = () => {
    if (built?.secret && built.proof) {
      const nonCanonical = finalizeEvent(
        {
          kind: 10011,
          created_at: built.now - 25,
          tags: [['i', `bch:${built.proof.statement.cashaddr}`, JSON.stringify(built.proof, null, 2)]],
          content: '',
        },
        built.secret,
      );
      setText(pretty(nonCanonical));
      setTamperNote('pretty-printed JCS proof');
      return;
    }
    try {
      const parsed = JSON.parse(text) as { tags?: string[][] };
      if (Array.isArray(parsed.tags) && parsed.tags[0]?.[2]) {
        const proofObj = JSON.parse(parsed.tags[0][2]);
        parsed.tags[0][2] = JSON.stringify(proofObj, null, 2);
        setText(pretty(parsed));
        setTamperNote('pretty-printed JCS proof');
        return;
      }
    } catch {
      /* fallback */
    }
    tamperSig();
  };

  const resetEdits = () => {
    setText(original);
    setTamperNote(undefined);
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

  const auditEntries = Object.values(audit);
  const auditDone = auditEntries.length === SCENARIOS.length && auditEntries.every((a) => a.matched);
  const totalMs = auditEntries.reduce((sum, a) => sum + a.ms, 0);

  return (
    <div className="wrap page">
      <div className="page-head page-head--split">
        <div>
          <h1>Lab</h1>
          <p>Each case is built in your browser with throwaway keys and checked by the same verifier wallets and apps use. Edit the event JSON to try your own attack.</p>
        </div>
        <div className="lab-head__actions">
          {auditDone && !sweeping && (
            <span className="lab-audit-pill mono" role="status">
              <IconCheck size={12} strokeWidth={2.4} /> {SCENARIOS.length}/{SCENARIOS.length} as expected · {totalMs.toFixed(1)} ms
            </span>
          )}
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => void runAllCases()} disabled={sweeping}>
            {sweeping ? <Spinner /> : <IconPlay size={12} />} {sweeping ? `Testing ${auditEntries.length}/${SCENARIOS.length}…` : `Run all ${SCENARIOS.length} cases`}
          </button>
        </div>
      </div>
      <div className="lab">
        <nav ref={nav} className="scenarios" aria-label="Scenarios" onKeyDown={onNavKey}>
          {SCENARIOS.map((s, i) => {
            const a = audit[s.id];
            return (
              <button key={s.id} data-id={s.id} type="button" className="scenario" aria-pressed={s.id === active} onClick={() => choose(s.id)}>
                <span className="scenario__n mono">
                  {a?.matched ? (
                    <span className="scenario__audit-dot" data-ok={s.expect === 'ok'} title={`Verified in ${a.ms.toFixed(1)} ms`}>
                      <IconCheck size={10} strokeWidth={2.5} />
                    </span>
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>
                <span className="scenario__text">
                  <strong>{s.title}</strong>
                  <small>{s.blurb}</small>
                  <span className="scenario__expect mono" data-ok={s.expect === 'ok'}>
                    {s.expect === 'ok' ? 'valid' : s.expect}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
        <section className="c-card lab__result" aria-live="polite">
          {result ? (
            <>
              <div className="verdict" data-ok={result.ok} key={`${active}-${seed}-${result.code}`}>
                <span className="verdict__mark">{result.ok ? <IconCheck size={20} strokeWidth={2.2} /> : <IconX size={18} strokeWidth={2.2} />}</span>
                <div className="verdict__text">
                  <h2>{result.ok ? 'Valid binding' : VERIFY_CODES[result.code]}</h2>
                  <p>
                    {result.ok ? 'All checks pass.' : <code>{result.code}</code>}
                    {!edited && matches && <span className="muted"> · as expected</span>}
                    {edited && <span className="muted"> · {tamperNote ?? 'edited by you'}</span>}
                  </p>
                  {!edited && <div className="verdict__focus mono">{scenario.focus}</div>}
                </div>
                <div className="verdict__actions">
                  <button
                    type="button"
                    className="c-btn c-btn--ghost c-btn--sm"
                    onClick={() => setSeed((x) => x + 1)}
                    disabled={sweeping}
                    title="Rebuild with fresh keys"
                  >
                    <IconRefresh size={14} /> New keys
                  </button>
                </div>
              </div>
              <div className="lab__checks">
                {built?.aside && !edited && <Note>{built.aside}</Note>}
                <CheckList key={`${active}-${seed}-${result.code}`} checks={result.checks} stagger={sweeping ? 15 : 40} />
              </div>
            </>
          ) : (
            <div className="lab__loading" aria-hidden>
              <span className="c-skel" style={{ width: '46%', height: 18 }} />
              <span className="c-skel" style={{ width: '28%' }} />
            </div>
          )}
          <div className="lab__editor-bar">
            <label htmlFor="event-json" className="lab__editor-title">
              <span>Event JSON</span>
              {edited && <span className="lab__edited">{tamperNote ?? 'edited'}</span>}
            </label>
            <div className="lab__editor-tools">
              {result?.ok && (
                <>
                  <button type="button" className="c-btn c-btn--ghost c-btn--sm lab__tamper-btn" onClick={tamperAddress}>
                    Swap address
                  </button>
                  <button type="button" className="c-btn c-btn--ghost c-btn--sm lab__tamper-btn hide-sm" onClick={tamperSig}>
                    Flip sig bit
                  </button>
                  <button type="button" className="c-btn c-btn--ghost c-btn--sm lab__tamper-btn hide-sm" onClick={tamperCanonical}>
                    Break JCS
                  </button>
                </>
              )}
              {edited && (
                <button type="button" className="c-btn c-btn--ghost c-btn--sm" onClick={resetEdits}>
                  <IconUndo size={13} /> Restore
                </button>
              )}
              <CopyIcon value={text} title="Copy event JSON" />
            </div>
          </div>
          <textarea
            id="event-json"
            className="lab__editor"
            value={text}
            onChange={(e) => {
              setTamperNote(undefined);
              setText(e.target.value);
            }}
            spellCheck={false}
          />
        </section>
      </div>
    </div>
  );
};
