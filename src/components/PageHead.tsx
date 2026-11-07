/** A page's title, one quiet line on what the page is for, and its one or two main buttons. */
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-title"><h1>{title}</h1>{sub && <p className="page-sub">{sub}</p>}</div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
