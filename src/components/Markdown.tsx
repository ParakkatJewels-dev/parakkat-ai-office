// Turns an agent's markdown report into readable headings, lists, tables and paragraphs.
// It builds React elements only (never raw HTML), so a report can't inject markup into the page.
import { Fragment, type ReactNode } from 'react';

/** **bold**, *italic* and `code` inside one line. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong> : t.startsWith('`') ? <code key={`${key}-${i++}`}>{t.slice(1, -1)}</code> : <em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function Markdown({ text, className = 'md' }: { text: string; className?: string }) {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length, Tag = (level <= 2 ? 'h3' : level === 3 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5';
      blocks.push(<Tag key={k++}>{inline(heading[2], `h${k}`)}</Tag>); i++; continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { blocks.push(<hr key={k++} />); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line), rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(<div className="md-table" key={k++}><table><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${k}${j}`)}</th>)}</tr></thead><tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${k}${ri}${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const bullet = /^\s*[-*•]\s+/, numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line), re = ordered ? numbered : bullet, items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={k++}>{items.map((t, j) => <li key={j}>{inline(t, `li${k}${j}`)}</li>)}</List>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={k++}>{inline(quote.join(' '), `q${k}`)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^\s*[-*•]\s+|^\s*\d+[.)]\s+|^\s*>|^\s*\|.*\|\s*$/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { para.push(lines[i++].trim()); }
    blocks.push(<p key={k++}>{para.map((t, j) => <Fragment key={j}>{j > 0 && <br />}{inline(t, `p${k}${j}`)}</Fragment>)}</p>);
  }
  return <div className={className}>{blocks}</div>;
}
