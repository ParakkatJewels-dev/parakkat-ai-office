import { Icon } from './Icon';

/**
 * A page's title and its one or two main buttons. The explanation that used to sit under every title
 * now waits behind a small ⓘ button, so the page opens on what matters.
 */
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-title"><h1>{title}</h1>{sub && <details className="about"><summary aria-label={`About ${title}`} title={`About ${title}`}><Icon name="info" size={18} /></summary><p>{sub}</p></details>}</div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
