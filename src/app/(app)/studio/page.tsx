import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { FORMATS, LANGS, canDesign } from '@/lib/agents/design';
import { Icon } from '@/components/Icon';
import { PageHead, Tile, Pager, pageOf, rangeOf, when } from '@/components/ui';
import { PRODUCT_PAGE as PAGE } from '@/lib/limits';
import { StudioForm } from './StudioForm';
import { reviewImage, redesign, scanNow, removeFolder, markRef } from './actions';
import { FolderPicker } from './FolderPicker';
import { Refresher } from '@/components/Refresher';
import { Locked, Submit } from '@/components/forms';
import { ROLE_LABEL, type AppRole } from '@/lib/roles';

export const maxDuration = 300; // designs are drawn after the page answers: Gemini draws, the team lead checks, one redo can follow
const GALLERY = 18, LIBRARY = 24;

const SHOW = { all: 'All', todo: 'Not reviewed', good: 'Good', bad: 'Bad' } as const;
const FROM = { all: 'Everything', design: 'Studio orders', creative: 'Campaign banners' } as const;
const KIND: Record<string, string> = { banner: 'Campaign banner', story: 'Story', catalogue_page: 'Catalogue page', email: 'Email' };
const REFS = { all: 'In use', pinned: 'Pinned', hidden: 'Hidden', waiting: 'Not studied yet' } as const;
const BUSY = ['queued', 'making'];

export default async function Studio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { db, role } = await requireUser();
  if (!(await canDesign(db, role))) redirect('/office');
  const sp = await searchParams, tab = sp.tab === 'order' ? 'order' : sp.tab === 'library' ? 'library' : 'gallery';
  const show = (sp.show && sp.show in SHOW ? sp.show : 'all') as keyof typeof SHOW, from = (sp.from && sp.from in FROM ? sp.from : 'all') as keyof typeof FROM;
  const gp = pageOf(sp, 'gp'), [g0, g1] = rangeOf(gp, GALLERY);
  const qs = (patch: Record<string, string | null>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ tab: sp.tab, show: sp.show, from: sp.from, ...patch })) if (v && !(k === 'show' && v === 'all') && !(k === 'from' && v === 'all')) q.set(k, v); return `/studio${q.size ? `?${q}` : ''}`; };

  let list = db.from('ai_images').select('source, id, kind, brief, headline, language, image_path, status, lead_note, error, created_at, campaign_name, verdict, review, reviewer_role, reviewed_at, concept, ref_ids, versions, redo_note', { count: 'exact' });
  if (from !== 'all') list = list.eq('source', from);
  if (show === 'todo') list = list.is('verdict', null); else if (show !== 'all') list = list.eq('verdict', show);
  const [{ data: items, count }, { count: total }, { count: todo }, { count: good }, { count: bad }, prod, { count: busy }, { count: library }] = await Promise.all([
    list.order('created_at', { ascending: false }).range(g0, g1),
    db.from('ai_images').select('id', { count: 'exact', head: true }),
    db.from('ai_images').select('id', { count: 'exact', head: true }).is('verdict', null),
    db.from('ai_images').select('id', { count: 'exact', head: true }).eq('verdict', 'good'),
    db.from('ai_images').select('id', { count: 'exact', head: true }).eq('verdict', 'bad'),
    // the order form's first page of products; the picker loads the rest as you search
    tab === 'order' ? db.from('products').select('id, title, price, image_url', { count: 'exact' }).eq('status', 'ACTIVE').not('image_url', 'is', null).order('updated_at', { ascending: false }).range(0, PAGE - 1) : Promise.resolve({ data: [], count: 0 }),
    db.from('ai_images').select('id', { count: 'exact', head: true }).in('status', BUSY),
    db.from('design_refs').select('id', { count: 'exact', head: true }).eq('status', 'ready').eq('hidden', false),
  ]);
  const products = prod.data || [];
  // the past designs each image was built from, shown small under it
  const refIds = [...new Set((items || []).flatMap(d => (d.ref_ids || []) as string[]))];
  const { data: usedRefs } = refIds.length ? await db.from('design_refs').select('id, name, image_path, occasion').in('id', refIds) : { data: [] };
  const R = new Map((usedRefs || []).map(r => [r.id, r]));
  const paths = [...(items || []).map(d => d.image_path), ...(usedRefs || []).map(r => r.image_path)].filter(Boolean) as string[];
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
      {sp.made && <p className="flash ok">Design ordered. It is first in the gallery and takes about a minute; you can leave this page.</p>}
      <Refresher active={(busy || 0) > 0 && tab === 'gallery'}>{busy} design{busy === 1 ? ' is' : 's are'} being drawn in the background. This page updates on its own.</Refresher>
      <PageHead title="Design Studio" sub="Every image the AI designers make, from campaign banners to the designs you order. Mark each one good or bad: your notes become lessons the designers follow next time." />

      <section className="tiles" aria-label="Summary">
        <Tile icon="spark" label="AI images" value={total || 0} sub="Studio orders and campaign banners" />
        <Tile icon="clock" tone="amber" label="Waiting for your review" value={todo || 0} sub={todo ? <a href={qs({ show: 'todo', tab: null })}>Review them</a> : 'All reviewed'} />
        <Tile icon="check" tone="blue" label="Marked good" value={good || 0} sub="The designers make more like these" />
        <Tile icon="eye" tone="violet" label="Past designs to learn from" value={library || 0} sub={<a href="/studio?tab=library">{library ? 'Open the library' : 'Add your Drive folders'}</a>} />
      </section>

      <nav className="tabs" aria-label="Design Studio">
        <a href={qs({ tab: null })} className={tab === 'gallery' ? 'on' : ''} aria-current={tab === 'gallery' ? 'page' : undefined}><Icon name="spark" size={16} />Gallery and reviews</a>
        <a href="/studio?tab=order" className={tab === 'order' ? 'on' : ''} aria-current={tab === 'order' ? 'page' : undefined}><Icon name="plus" size={16} />Order a design</a>
        <a href="/studio?tab=library" className={tab === 'library' ? 'on' : ''} aria-current={tab === 'library' ? 'page' : undefined}><Icon name="eye" size={16} />Design library</a>
      </nav>

      {tab === 'library' ? <Library db={db} sp={sp} admin={role === 'super_admin'} /> : tab === 'order' ? (
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
                  {d.image_path && view(d.image_path) ? <img src={view(d.image_path)} alt={d.headline || d.brief} loading="lazy" /> : <span className="sub">{d.status === 'failed' ? 'Failed' : 'Designing… about a minute'}</span>}
                  {d.verdict && !BUSY.includes(d.status) && <span className={`verdict ${d.verdict}`}>{d.verdict === 'good' ? 'Good' : 'Bad'}</span>}
                  {BUSY.includes(d.status) && d.image_path && <span className="redoing"><span className="spin" aria-hidden="true" />Making version {(d.versions || 0) + 2}</span>}
                  {!BUSY.includes(d.status) && d.versions > 0 && <span className="ver">v{d.versions + 1}</span>}
                </div>
                <div className="meta">
                  <div className="conn-top"><b>{f?.label || KIND[d.kind] || d.kind}</b><span className="pill">{d.source === 'design' ? 'Studio order' : 'Campaign'}</span></div>
                  {d.campaign_name && <span className="sm clip">{d.campaign_name}</span>}
                  <p className="clip2">{d.headline ? <b>{d.headline}. </b> : null}{d.brief}</p>
                  {(d.lead_note || d.error) && <p className={`sm ${d.error ? 'err' : ''}`}>{d.error ? `${d.image_path ? 'The last redesign failed: ' : ''}${d.error}` : `AI lead: ${d.lead_note}`}</p>}
                  {(d.concept || (d.ref_ids || []).length > 0) && <details className="built"><summary>How it was made{(d.ref_ids || []).length ? ` · ${(d.ref_ids || []).length} past design${(d.ref_ids || []).length === 1 ? '' : 's'}` : ''}</summary>
                    {(d.ref_ids || []).length > 0 && <div className="ref-thumbs">{(d.ref_ids as string[]).map(r => R.get(r)).filter(Boolean).map(r => r!.image_path && view(r!.image_path) && <img key={r!.id} src={view(r!.image_path)} alt={r!.name} title={`${r!.name}${r!.occasion ? ` · ${r!.occasion}` : ''}`} loading="lazy" />)}</div>}
                    {d.concept && <p className="sm">{d.concept}</p>}
                    {d.redo_note && <p className="sm">You asked: {d.redo_note}</p>}
                  </details>}
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
                  {(d.image_path || d.status === 'failed') && !BUSY.includes(d.status) && (
                    <details className="redo"><summary><Icon name="sync" size={14} />Redesign</summary>
                      <form action={redesign}>
                        <input type="hidden" name="source" value={d.source} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={`${back}#d-${d.id}`} />
                        <textarea name="note" className="in" rows={2} maxLength={600} placeholder="What to change (optional). Empty tries a new direction." aria-label="What to change" />
                        <Submit small icon="sync" pending="Starting…">Make a new version</Submit>
                      </form>
                    </details>
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

type Db = Awaited<ReturnType<typeof requireUser>>['db'];

/** Past Parakkat designs from Drive that the designers take their standard from. */
async function Library({ db, sp, admin }: { db: Db; sp: Record<string, string | undefined>; admin: boolean }) {
  const show = (sp.lib && sp.lib in REFS ? sp.lib : 'all') as keyof typeof REFS, q = (sp.q || '').trim().slice(0, 80);
  const lp = pageOf(sp, 'lp'), [l0, l1] = rangeOf(lp, LIBRARY);
  let list = db.from('design_refs').select('id, name, image_path, status, error, kind, occasion, style, palette, tags, quality, pinned, hidden, uses, folder_id', { count: 'exact' });
  if (show === 'waiting') list = list.in('status', ['new', 'failed']);
  else { list = list.eq('status', 'ready'); list = show === 'hidden' ? list.eq('hidden', true) : list.eq('hidden', false); if (show === 'pinned') list = list.eq('pinned', true); }
  if (q) list = list.textSearch('search', q, { type: 'websearch', config: 'simple' });
  const [{ data: refs, count }, { data: roots }, { count: ready }, { count: waiting }, { count: skipped }, { data: job }] = await Promise.all([
    list.order('pinned', { ascending: false }).order('created_at', { ascending: false }).range(l0, l1),
    db.from('design_library_folders').select('id, root_id, name, files, scanned_at, page_token, error').order('created_at').limit(500),
    db.from('design_refs').select('id', { count: 'exact', head: true }).eq('status', 'ready').eq('hidden', false),
    db.from('design_refs').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('design_refs').select('id', { count: 'exact', head: true }).in('status', ['skipped', 'failed']),
    db.from('autopilot_jobs').select('last_run_at, last_result').eq('name', 'library').maybeSingle(),
  ]);
  const picked = (roots || []).filter(f => f.id === f.root_id);
  const sub = (root: string) => (roots || []).filter(f => f.root_id === root);
  const reading = (roots || []).some(f => !f.scanned_at || f.page_token) || (waiting || 0) > 0;
  const paths = (refs || []).map(r => r.image_path).filter(Boolean) as string[];
  const signed = paths.length ? (await db.storage.from('creatives').createSignedUrls(paths, 3600)).data || [] : [];
  const url = (p: string | null) => p ? signed.find(x => x.path === p)?.signedUrl ?? undefined : undefined;
  const qs = (patch: Record<string, string | null>) => { const u = new URLSearchParams({ tab: 'library' }); for (const [k, v] of Object.entries({ lib: sp.lib, q: sp.q, ...patch })) if (v && !(k === 'lib' && v === 'all')) u.set(k, v); return `/studio?${u}`; };
  const back = qs({ lp: lp > 1 ? String(lp) : null });
  return <>
    <Refresher active={reading} every={15000}>The Banner Designer is reading your folders and studying new designs in the background{waiting ? `: ${waiting} to go` : ''}. This page updates on its own.</Refresher>
    <div className="bento">
      <section className="card s8 wide-md">
        <div className="card-head"><div><h3>Where the past designs come from</h3><p className="sub">Google Drive folders of designs Parakkat has run before. Subfolders are read too. Each design is studied once for its occasion, style, colours, layout and type, and every new banner starts from the closest few.</p></div>
          <form action={scanNow}><Submit ghost small icon="sync" pending="Starting…">Read again</Submit></form></div>
        {picked.length ? <ul className="rows">{picked.map(f => {
          const all = sub(f.id), files = all.reduce((n, x) => n + (x.files || 0), 0), err = all.find(x => x.error)?.error, busy = all.some(x => !x.scanned_at || x.page_token);
          return (
            <li key={f.id}><span className="tile-ic"><Icon name="doc" size={16} /></span>
              <div className="grow"><b className="clip">{f.name}</b>
                <span className={`sm ${err ? 'err' : ''}`}>{err ? err : `${files} design file${files === 1 ? '' : 's'} in ${all.length} folder${all.length === 1 ? '' : 's'} · ${busy ? 'reading now' : `read ${when(f.scanned_at)}`}`}</span></div>
              <a className="btn ghost sm-btn" href={`https://drive.google.com/drive/folders/${f.id}`} target="_blank" rel="noreferrer">Open in Drive</a>
              {admin && <form action={removeFolder}><input type="hidden" name="id" value={f.id} /><Submit ghost small pending="Removing…">Remove</Submit></form>}
            </li>
          );
        })}</ul> : <div className="empty"><Icon name="doc" size={26} /><p>No folders yet.{admin ? ' Add the Drive folders where your past designs are kept.' : ' The Super Admin adds them from this tab.'}</p></div>}
        {admin ? <FolderPicker /> : null}
        {admin && <p className="sm">Drive is read with the Google sign-in on Admin, Connections. If Google was connected before this, press Reconnect there once so Drive is allowed.</p>}
      </section>
      <section className="card s4 wide-md">
        <div className="card-head"><div><h3>Library</h3><p className="sub">{job?.last_run_at ? `Last pass ${when(job.last_run_at)}` : 'Not read yet'}</p></div></div>
        <div className="facts one">
          <div><small>Ready to learn from</small><b>{ready || 0}</b></div>
          <div><small>Waiting to be studied</small><b>{waiting || 0}</b></div>
          <div><small>Skipped (not a finished design) or unreadable</small><b>{skipped || 0}</b></div>
        </div>
        {job?.last_result && <p className={`sm ${job.last_result.startsWith('failed') ? 'err' : ''}`}>{job.last_result.slice(0, 200)}</p>}
      </section>
    </div>

    <section className="card">
      <div className="card-head"><div><h3>Past designs</h3><p className="sub">Pin the ones you want the designers to follow more; hide any that should not be followed. {count || 0} shown.</p></div></div>
      <div className="seg-row">
        <div className="seg" role="group" aria-label="Show">{Object.entries(REFS).map(([k, l]) => <a key={k} href={qs({ lib: k, lp: null })} className={show === k ? 'on' : ''}>{l}</a>)}</div>
        <form action="/studio" className="inline"><input type="hidden" name="tab" value="library" />{sp.lib && <input type="hidden" name="lib" value={sp.lib} />}
          <input className="in" name="q" defaultValue={q} placeholder="Search: Onam, bridal, green…" aria-label="Search the library" /></form>
      </div>
      {(refs || []).length ? <ul className="gallery lib">{refs!.map(r => (
        <li key={r.id} className={r.pinned ? 'pinned' : ''}>
          <div className="art">{url(r.image_path) ? <img src={url(r.image_path)} alt={r.name} loading="lazy" /> : <span className="sub">{r.status === 'failed' ? 'Could not read' : 'Not studied yet'}</span>}
            {r.pinned && <span className="ver">Pinned</span>}</div>
          <div className="meta">
            <div className="conn-top"><b className="clip" title={r.name}>{r.name}</b>{r.occasion && <span className="pill">{r.occasion}</span>}</div>
            {r.error ? <p className="sm err">{r.error}</p> : r.style && <p className="clip2 sm">{r.style}</p>}
            {r.status === 'ready' && <span className="sm">{[r.kind, r.quality ? `finish ${r.quality}/5` : null, r.uses ? `used ${r.uses} time${r.uses === 1 ? '' : 's'}` : 'not used yet'].filter(Boolean).join(' · ')}</span>}
            {r.status === 'ready' && <div className="conn-top">
              <form action={markRef}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="what" value={r.pinned ? 'unpin' : 'pin'} />
                <Submit ghost small icon="pin" pending="Saving…">{r.pinned ? 'Unpin' : 'Pin'}</Submit></form>
              <form action={markRef}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="what" value={r.hidden ? 'show' : 'hide'} />
                <Submit ghost small icon={r.hidden ? 'eye' : 'x'} pending="Saving…">{r.hidden ? 'Use again' : 'Hide'}</Submit></form>
            </div>}
          </div>
        </li>
      ))}</ul> : <div className="empty"><Icon name="eye" size={26} /><p>{q ? `Nothing in the library matches "${q}".` : picked.length ? 'Nothing here yet. Designs appear as they are studied.' : 'Add a Drive folder above to start the library.'}</p></div>}
      <Pager sp={sp} param="lp" page={lp} size={LIBRARY} total={count} shown={(refs || []).length} />
    </section>
  </>;
}
