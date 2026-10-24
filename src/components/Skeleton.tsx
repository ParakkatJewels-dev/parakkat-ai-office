/** Shown while a page's data streams in, shaped like the page so nothing jumps when it arrives. */
export function PageSkeleton({ tiles = 4, cards = 2 }: { tiles?: number; cards?: number }) {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="tiles">{Array.from({ length: tiles }, (_, i) => <div key={i} className="tile sk-tile"><div className="sk sk-line w40" /><div className="sk sk-line w60 tall" /></div>)}</div>
      <div className="bento">{Array.from({ length: cards }, (_, i) => <div key={i} className={`card ${i ? 's4' : 's8'}`}><div className="sk sk-line w30" />{Array.from({ length: 6 }, (_, j) => <div key={j} className="sk sk-line" />)}</div>)}</div>
    </div>
  );
}
