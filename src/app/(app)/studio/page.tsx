import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { FORMATS, LANGS, canDesign } from '@/lib/agents/design';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Pager, pageOf, rangeOf, when } from '@/components/ui';
import { PRODUCT_PAGE as PAGE } from '@/lib/limits';
import { StudioForm } from './StudioForm';

export const maxDuration = 300; // Gemini draws, the team lead checks, and one redo can follow
const GALLERY = 12;

export default async function Studio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  const sp = await searchParams, gp = pageOf(sp, 'gp'), [g0, g1] = rangeOf(gp, GALLERY);
  // the first page of products comes with the page; the picker loads the rest as you search
  const [{ data: firstProducts, count: productCount }, { data: designs, count: designCount }, { count: ready }] = await Promise.all([
    db.from('products').select('id, title, price, image_url', { count: 'exact' }).eq('status', 'ACTIVE').not('image_url', 'is', null).order('updated_at', { ascending: false }).range(0, PAGE - 1),
    db.from('designs').select('id, format, brief, headline, language, image_path, status, review_note, error, created_at', { count: 'exact' }).order('created_at', { ascending: false }).range(g0, g1),
    db.from('designs').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
  ]);
  const products = firstProducts || [];
  const paths = (designs || []).map(d => d.image_path).filter(Boolean) as string[];
  const [views, downloads] = paths.length ? await Promise.all([
    db.storage.from('creatives').createSignedUrls(paths, 3600),
    Promise.all(paths.map(p => db.storage.from('creatives').createSignedUrl(p, 3600, { download: `parakkat-${p.split('/').pop()}` }))),
  ]) : [{ data: [] }, []];
  const view = (p: string) => views.data?.find(s => s.path === p)?.signedUrl ?? undefined;
  const dl = (p: string) => downloads[paths.indexOf(p)]?.data?.signedUrl;

  return (
    <div className="page">
      {sp.error && <p className="flash">{sp.error}</p>}
      {sp.made && <p className="flash ok">The design is ready. It is first in the gallery below.</p>}
      <PageHead title="Design Studio" sub="Banners and posters made from your real Shopify product photos. The jewellery stays exactly as photographed; the designers build the scene, light and type around it." />

      <section className="tiles" aria-label="Summary">
        <Tile icon="spark" label="Designs made" value={designCount || 0} sub="All designs, newest first below" />
        <Tile icon="check" tone="blue" label="Passed the lead's check" value={ready || 0} sub="Matched the product photos" />
        <Tile icon="bag" tone="amber" label="Products with photos" value={productCount || 0} sub="Ready to design with" />
        <Tile icon="doc" tone="violet" label="Formats" value={Object.keys(FORMATS).length} sub="Posts, stories, banners, posters" />
      </section>

      <div className="studio">
        <StudioForm products={products as any} more={(productCount || 0) > products.length} formats={Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, ratio: f.ratio, size: f.size }))} />
        <section className="card">
          <div className="card-head"><div><h3>Gallery</h3><p className="sub">Newest first. Download the ones you want to use.</p></div></div>
          {(designs || []).length ? <ul className="gallery">{designs!.map(d => {
            const f = FORMATS[d.format as keyof typeof FORMATS];
            return (
              <li key={d.id} id={`d-${d.id}`} className={sp.made === d.id ? 'new' : ''}>
                <div className="art" style={{ aspectRatio: f?.ratio.replace(':', '/') || '1' }}>
                  {d.image_path && view(d.image_path) ? <img src={view(d.image_path)} alt={d.headline || d.brief} loading="lazy" /> : <span className="sub">{d.status === 'failed' ? 'Failed' : 'Still designing…'}</span>}
                </div>
                <div className="meta">
                  <div className="conn-top"><b>{f?.label || d.format}</b><span className={`pill ${d.status === 'ready' ? 'good' : d.status === 'failed' ? 'bad' : 'warn'}`}>{d.status === 'ready' ? 'Checked' : d.status === 'needs_fix' ? 'Has a note' : d.status}</span></div>
                  <p className="clip2">{d.brief}</p>
                  {(d.review_note || d.error) && <p className={`sm ${d.error ? 'err' : ''}`}>{d.error || d.review_note}</p>}
                  <div className="conn-top"><span className="sm">{LANGS[d.language as keyof typeof LANGS]} · {when(d.created_at)}</span>
                    {d.image_path && dl(d.image_path) && <a className="btn ghost sm-btn" href={dl(d.image_path)}><Icon name="arrow" size={16} />Download</a>}</div>
                </div>
              </li>
            );
          })}</ul> : <div className="empty"><Icon name="spark" size={26} /><p>No designs yet. Order the first one on the left.</p></div>}
          <Pager sp={sp} param="gp" page={gp} size={GALLERY} total={designCount} shown={(designs || []).length} />
        </section>
      </div>
    </div>
  );
}
