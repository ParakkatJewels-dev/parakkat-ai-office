'use client';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/Icon';
import { orderDesign } from './actions';

type Product = { id: number; title: string; price: number | null; image_url: string };
type Fmt = { id: string; label: string; ratio: string; size: string };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className={`btn ${pending ? 'busy' : ''}`} disabled={pending} aria-live="polite" aria-busy={pending}>
      {pending ? <span className="spin" aria-hidden="true" /> : <Icon name="spark" size={18} />}{pending ? 'Designing… this takes about a minute' : 'Make the design'}
    </button>
  );
}

/** The order form: format, brief, headline, language, and up to three Shopify products to build around. */
export function StudioForm({ products, more: firstMore, formats }: { products: Product[]; more: boolean; formats: Fmt[] }) {
  const [q, setQ] = useState(''), [picked, setPicked] = useState<number[]>([]), [fmt, setFmt] = useState(formats[0].id);
  // products load a page at a time from /api/products as you search or ask for more; picks are remembered across searches
  const [list, setList] = useState(products), [more, setMore] = useState(firstMore), [page, setPage] = useState(0), [busy, setBusy] = useState(false);
  const known = useRef(new Map(products.map(p => [p.id, p])));
  const load = async (search: string, n: number) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/products?q=${encodeURIComponent(search)}&page=${n}`);
      if (!r.ok) return;
      const j: { products: Product[]; more: boolean } = await r.json();
      j.products.forEach(p => known.current.set(p.id, p));
      setList(l => n ? [...l, ...j.products] : j.products); setMore(j.more); setPage(n);
    } finally { setBusy(false); }
  };
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => load(q.trim(), 0), 250); return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = [...picked.map(id => known.current.get(id)!).filter(Boolean), ...list.filter(p => !picked.includes(p.id))];
  const toggle = (id: number) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.length < 3 ? [...p, id] : p);

  return (
    <form action={orderDesign} className="card studio-form">
      <div className="card-head"><div><h3>Order a design</h3><p className="sub">The Banner Designer makes social and web designs; the Print Designer makes posters. Their AI team lead checks each one against the real product photos.</p></div></div>

      <fieldset className="fmts"><legend className="eyebrow">Format</legend>
        {formats.map(f => (
          <label key={f.id} className={fmt === f.id ? 'on' : ''}>
            <input type="radio" name="format" value={f.id} checked={fmt === f.id} onChange={() => setFmt(f.id)} />
            <i className="shape" style={{ aspectRatio: f.ratio.replace(':', '/') }} /><b>{f.label}</b><small>{f.size}</small>
          </label>
        ))}
      </fieldset>

      <label className="field">What is it for?<textarea name="brief" required rows={3} placeholder="Onam offer on temple necklaces, for Instagram this week. Festive but premium." /></label>
      <div className="two">
        <label className="field">Headline (optional)<input name="headline" maxLength={60} placeholder="Leave empty and the Copywriter writes one" /></label>
        <label className="field">Language<select name="language" defaultValue="en"><option value="en">English</option><option value="ml">Malayalam</option></select></label>
      </div>

      <fieldset className="picker"><legend className="eyebrow">Products to feature <span>{picked.length}/3</span></legend>
        <input className="in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search Shopify products…" aria-label="Search products" />
        {shown.length ? <ul aria-busy={busy}>{shown.map(p => (
          <li key={p.id}>
            <label className={picked.includes(p.id) ? 'on' : ''}>
              <input type="checkbox" name="product" value={p.id} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} disabled={!picked.includes(p.id) && picked.length >= 3} />
              <img src={p.image_url} alt="" loading="lazy" decoding="async" /><span>{p.title}</span>
            </label>
          </li>
        ))}</ul> : <p className="sub">{q ? `No products match "${q}".` : 'No products with photos yet. Sync Shopify from the Admin page first.'}</p>}
        {more && <button type="button" className="btn ghost sm-btn more" disabled={busy} onClick={() => load(q.trim(), page + 1)}>{busy ? 'Loading…' : 'Show more products'}</button>}
      </fieldset>
      <Submit />
    </form>
  );
}
