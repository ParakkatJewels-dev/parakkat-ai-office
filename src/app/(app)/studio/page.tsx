import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { FORMATS, LANGS, canDesign } from '@/lib/agents/design';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Pager, pageOf, rangeOf, when } from '@/components/ui';
import { PRODUCT_PAGE as PAGE } from '@/lib/limits';
import { StudioForm } from './StudioForm';
import { reviewImage } from './actions';
import { Locked } from '@/components/forms';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';

export const maxDuration = 300; // Gemini draws, the team lead checks, and one redo can follow
const GALLERY = 18;

const SHOW = { all: 'All', todo: 'Not reviewed', good: 'Good', bad: 'Bad' } as const;
const FROM = { all: 'Everything', design: 'Studio orders', creative: 'Campaign banners' } as const;
const KIND: Record<string, string> = { banner: 'Campaign banner', story: 'Story', catalogue_page: 'Catalogue page', email: 'Email' };

export default async function Studio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  const sp = await searchParams, tab = sp.tab === 'order' ? 'order' : 'gallery';
  const show = (sp.show && sp.show in SHOW ? sp.show : 'all') as keyof typeof SHOW, from = (sp.from && sp.from in FROM ? sp.from : 'all') as keyof typeof FROM;
  const gp = pageOf(sp, 'gp'), [g0, g1] = rangeOf(gp, GALLERY);
  const qs = (patch: Record<string, string | null>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ tab: sp.tab, show: sp.show, from: sp.from, ...patch })) if (v && !(k === 'show' && v === 'all') && !(k === 'from' && v === 'all')) q.set(k, v); return `/studio${q.size ? `?${q}` : ''}`; };

  let list = db.from('ai_images').select('source, id, kind, brief, headline, language, image_path, status, lead_note, error, created_at, campaign_name, verdict, review, reviewer_role, reviewed_at', { count: 'exact' });
  if (from !== 'all') list = list.eq('source', from);
  if (show === 'todo') list = list.is('verdict', null); else if (show !== 'all') list = list.eq('verdict', show);
  const [{ data: items, count }, { count: total }, { count: todo }, { count: good }, { count: bad }, prod] = await Promise.all([
    list.order('created_at', { ascending: false }).range(g0, g1),
    db.from('ai_images').select('id', { count: 'exact', head: true }),
    db.from('ai_images').select('id', { count: 'exact', head: true }).is('verdict', null),
    db.from('ai_images').select('id', { count: 'exact', head: true }).eq('verdict', 'good'),
    db.from('ai_images').select('id', { count: 'exact', head: true }).eq('verdict', 'bad'),
    // the order form's first page of products; the picker loads the rest as you search
    tab === 'order' ? db.from('products').select('id, title, price, image_url', { count: 'exact' }).eq('status', 'ACTIVE').not('image_url', 'is', null).order('updated_at', { ascending: false }).range(0, PAGE - 1) : Promise.resolve({ data: [], count: 0 }),
  ]);
  const products = prod.data || [];
  const paths = (items || []).map(d => d.image_path).filter(Boolean) as string[];
  const [views, downloads] = paths.length ? await Promise.all([
    db.storage.from('creatives').createSignedUrls(paths, 3600),
    Promise.all(paths.map(p => db.storage.from('creatives').createSignedUrl(p, 3600, { download: `parakkat-${p.split('/').pop()}` }))),
  ]) : [{ data: [] }, []];
  const view = (p: string) => views.data?.find(s => s.path === p)?.signedUrl ?? undefined;
  const dl = (p: string) => downloads[paths.indexOf(p)]?.data?.signedUrl;
  const back = qs({ gp: gp > 1 ? String(gp) : null });

  return (
    <div className="page">
      {sp.error && <p className="flash">{sp.error}</p>}
      {sp.msg && <p className="flash ok">{sp.msg}</p>}
      {sp.made && <p className="flash ok">The design is ready. It is first in the gallery.</p>}
      <PageHead title="Design Studio" sub="Every image the AI designers make, from campaign banners to the designs you order. Mark each one good or bad: your notes become lessons the designers follow next time." />

      <section className="tiles" aria-label="Summary">
        <Tile icon="spark" label="AI images" value={total || 0} sub="Studio orders and campaign banners" />
        <Tile icon="clock" tone="amber" label="Waiting for your review" value={todo || 0} sub={todo ? <a href={qs({ show: 'todo', tab: null })}>Review them</a> : 'All reviewed'} />
        <Tile icon="check" tone="blue" label="Marked good" value={good || 0} sub="The designers make more like these" />
        <Tile icon="x" tone="rose" label="Marked bad" value={bad || 0} sub="The designers avoid what you noted" />
      </section>

      <nav className="tabs" aria-label="Design Studio">
        <a href={qs({ tab: null })} className={tab === 'gallery' ? 'on' : ''} aria-current={tab === 'gallery' ? 'page' : undefined}><Icon name="spark" size={16} />Gallery and reviews</a>
        <a href="/studio?tab=order" className={tab === 'order' ? 'on' : ''} aria-current={tab === 'order' ? 'page' : undefined}><Icon name="plus" size={16} />Order a design</a>
      </nav>

      {tab === 'order' ? (
        <div className="studio one"><StudioForm products={products as any} more={(prod.count || 0) > products.length} formats={Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, ratio: f.ratio, size: f.size }))} /></div>
      ) : (
        <section className="card">
          <div className="card-head"><div><h3>Gallery</h3><p className="sub">Newest first. {count || 0} shown with these filters.</p></div></div>
          <div className="seg-row">
            <div className="seg" role="group" aria-label="Review">{Object.entries(SHOW).map(([k, l]) => <a key={k} href={qs({ show: k, gp: null })} className={show === k ? 'on' : ''}>{l}</a>)}</div>
            <div className="seg" role="group" aria-label="Made for">{Object.entries(FROM).map(([k, l]) => <a key={k} href={qs({ from: k, gp: null })} className={from === k ? 'on' : ''}>{l}</a>)}</div>
          </div>
          {(items || []).length ? <ul className="gallery">{items!.map(d => {
            const f = FORMATS[d.kind as keyof typeof FORMATS];
            return (
              <li key={`${d.source}-${d.id}`} id={`d-${d.id}`} className={`${sp.made === d.id ? 'new' : ''} ${d.verdict ? `rv-${d.verdict}` : ''}`}>
                <div className="art" style={{ aspectRatio: f?.ratio.replace(':', '/') || '1' }}>
                  {d.image_path && view(d.image_path) ? <img src={view(d.image_path)} alt={d.headline || d.brief} loading="lazy" /> : <span className="sub">{d.status === 'failed' ? 'Failed' : 'Still designing…'}</span>}
                  {d.verdict && <span className={`verdict ${d.verdict}`}>{d.verdict === 'good' ? 'Good' : 'Bad'}</span>}
                </div>
                <div className="meta">
                  <div className="conn-top"><b>{f?.label || KIND[d.kind] || d.kind}</b><span className="pill">{d.source === 'design' ? 'Studio order' : 'Campaign'}</span></div>
                  {d.campaign_name && <span className="sm clip">{d.campaign_name}</span>}
                  <p className="clip2">{d.headline ? <b>{d.headline}. </b> : null}{d.brief}</p>
                  {(d.lead_note || d.error) && <p className={`sm ${d.error ? 'err' : ''}`}>{d.error || `AI lead: ${d.lead_note}`}</p>}
                  <div className="conn-top"><span className="sm">{LANGS[d.language as keyof typeof LANGS] || d.language} · {when(d.created_at)}</span>
                    {d.image_path && dl(d.image_path) && <a className="btn ghost sm-btn" href={dl(d.image_path)}><Icon name="arrow" size={16} />Download</a>}</div>
                  {d.image_path && (
                    <Locked key={`${d.verdict}-${d.reviewed_at}`} action={reviewImage} saved={!!d.verdict} className="review" label="Save review"
                      savedNote={d.verdict ? `${d.reviewer_role ? ROLE_LABEL[d.reviewer_role as AppRole] : 'Reviewed'}${d.review ? `: ${d.review}` : ''}` : undefined}>
                      <input type="hidden" name="source" value={d.source} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
                      <div className="verdicts" role="radiogroup" aria-label="Your review">
                        <label className="vg"><input type="radio" name="verdict" value="good" defaultChecked={d.verdict === 'good'} required /><span>Good</span></label>
                        <label className="vb"><input type="radio" name="verdict" value="bad" defaultChecked={d.verdict === 'bad'} /><span>Bad</span></label>
                      </div>
                      <textarea name="note" className="in" rows={2} defaultValue={d.review || ''} placeholder="What works or what is wrong (needed for Bad)" aria-label="Review note" />
                    </Locked>
                  )}
                </div>
              </li>
            );
          })}</ul> : <div className="empty"><Icon name="spark" size={26} /><p>{show === 'todo' ? 'Nothing waiting for review.' : 'No images yet. Order one, or they arrive as campaigns are made.'}</p></div>}
          <Pager sp={sp} param="gp" page={gp} size={GALLERY} total={count} shown={(items || []).length} />
        </section>
      )}
    </div>
  );
}
