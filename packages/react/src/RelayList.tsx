import { relayHost } from './format.ts';

export interface RelayRow {
  url: string;
  tone: 'good' | 'bad' | 'warn' | 'wait' | 'idle';
  note: string;
  ms?: number;
}

export const RelayList = ({ rows }: { rows: RelayRow[] }) => (
  <div className="c-relays">
    {rows.map((r) => (
      <div key={r.url} className="c-relay" data-tone={r.tone}>
        <span className="c-relay__dot" />
        <span className="c-relay__host" title={r.url}>
          {relayHost(r.url)}
        </span>
        <span className="c-relay__note">{r.note}</span>
        <span className="c-relay__ms">{r.ms !== undefined ? `${r.ms} ms` : ''}</span>
      </div>
    ))}
  </div>
);
