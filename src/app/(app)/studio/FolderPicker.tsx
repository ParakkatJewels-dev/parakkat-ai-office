'use client';
import { useEffect, useState } from 'react';
import { Submit } from '@/components/forms';
import { folderIdFrom } from '@/lib/agents/library-core.mjs';
import { addFolder } from './actions';

type Folder = { id: string; name: string; modifiedTime?: string };

/** Paste a Drive folder link, or search the Super Admin's Drive by folder name and add one. */
export function FolderPicker() {
  const [q, setQ] = useState(''), [list, setList] = useState<Folder[]>([]), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const link = q.includes('/') || q.length > 25 ? folderIdFrom(q) : null;
  useEffect(() => {
    if (link || q.trim().length < 2) { setList([]); setErr(''); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/library/folders?q=${encodeURIComponent(q.trim())}`), j = await r.json();
        if (!r.ok) { setErr(j.error || 'Drive did not answer.'); setList([]); } else { setErr(''); setList(j.folders || []); }
      } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, link]);
  return (
    <div className="folder-pick">
      <label className="field">Add a Drive folder of past designs
        <input className="in" value={q} onChange={e => setQ(e.target.value)} placeholder="Paste the folder link, or type part of its name" />
      </label>
      {link && <form action={addFolder} className="inline"><input type="hidden" name="folder" value={link} /><Submit small icon="plus" pending="Checking the folder…">Add this folder</Submit></form>}
      {err && <p className="sm err" role="alert">{err}</p>}
      {!link && q.trim().length >= 2 && !err && (
        <ul className="rows folder-list" aria-busy={busy}>{list.length ? list.map(f => (
          <li key={f.id}><div className="grow"><b className="clip">{f.name}</b><span className="sm">{f.modifiedTime ? `Changed ${new Date(f.modifiedTime).toLocaleDateString('en-IN')}` : f.id}</span></div>
            <form action={addFolder} aria-label={`Add folder ${f.name}`}><input type="hidden" name="folder" value={f.id} /><Submit ghost small icon="plus" pending="Adding…">Add</Submit></form></li>
        )) : <li><span className="sm" role="status">{busy ? 'Searching Drive…' : `No folders named like "${q.trim()}".`}</span></li>}</ul>
      )}
    </div>
  );
}
