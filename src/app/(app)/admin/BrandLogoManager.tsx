'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './Settings.module.css';

export type ApprovedLogo = { id: string; name: string; imageUrl: string | null; createdAt: string };

async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : `The logo request failed (${response.status}). Reload and try again.`;
}

export function BrandLogoManager({ logos, activeId }: { logos: ApprovedLogo[]; activeId: string | null }) {
  const router = useRouter(), input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || choosing) return;
    const files = Array.from(input.current?.files || []);
    if (!files.length || files.length > 8) { setError('Choose between 1 and 8 approved logos.'); return; }
    if (files.some(file => file.size === 0 || file.size > 5 * 1024 * 1024)) { setError('Each logo must be larger than 0 bytes and no larger than 5 MiB.'); return; }
    const form = new FormData();
    for (const file of files) form.append('logos', file);
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/brand-logos', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json();
      if (input.current) input.current.value = '';
      setNotice(result.warning || (result.uploaded ? `${result.uploaded} approved logo${result.uploaded === 1 ? '' : 's'} saved. Choose an active logo below or select one in Studio.` : 'These logos are already in your approved library.'));
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The logos could not be uploaded. Try again.'); }
    finally { setBusy(false); }
  }

  async function setActive(id: string) {
    if (busy || choosing || id === activeId) return;
    setChoosing(id); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/brand-logos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice('Active logo changed. New artwork will use this exact approved mark.');
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The active logo could not be changed. Try again.'); }
    finally { setChoosing(null); }
  }

  return <div className={styles.logoManager}>
    <form className={styles.logoForm} onSubmit={event => void upload(event)}>
      <label className="field">Upload approved logos
        <input ref={input} name="logos" type="file" accept="image/png,image/webp,image/jpeg" multiple required disabled={busy || !!choosing} />
        <span className="sm">Select up to 8 PNG, WebP or JPEG files at once, each up to 5 MiB. Transparent PNG works best.</span>
      </label>
      <button className="btn" type="submit" disabled={busy || !!choosing}>{busy ? 'Uploading logos…' : 'Save logos'}</button>
    </form>
    {error && <p className="flash" role="alert">{error}</p>}
    {notice && <p className="flash ok" role="status">{notice}</p>}
    {logos.length > 0 && <div className={styles.logoLibrary} aria-label="Approved brand logos">
      {logos.map(logo => <div className={styles.logoTile} key={logo.id}>
        {logo.imageUrl ? <img src={logo.imageUrl} alt={logo.name} /> : <span className="sm">Preview unavailable</span>}
        <div><strong>{logo.name}</strong><span className="sm">{logo.id === activeId ? 'Active for new artwork' : 'Approved logo'}</span></div>
        {logo.id === activeId ? <span className="pill good">Active</span> : <button type="button" className="btn ghost sm-btn" disabled={busy || !!choosing} onClick={() => void setActive(logo.id)}>{choosing === logo.id ? 'Setting…' : 'Use for new artwork'}</button>}
      </div>)}
    </div>}
  </div>;
}
