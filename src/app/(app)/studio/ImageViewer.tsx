'use client';
import { useRef } from 'react';
import { Icon } from '@/components/Icon';
import styles from './ImageViewer.module.css';

export function ImageViewer({ src, title, download }: { src: string; title: string; download?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="btn ghost sm-btn" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}><Icon name="eye" size={16} />View image</button>
    <dialog ref={dialog} className={styles.dialog} aria-label={`Preview: ${title}`} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className={styles.content}>
        <header className={styles.header}><strong>{title}</strong><button type="button" className="btn ghost sm-btn" onClick={() => dialog.current?.close()} aria-label="Close image preview">Close</button></header>
        <img src={src} alt={title} />
        {download && <a className="btn sm-btn" href={download}>Download image</a>}
      </div>
    </dialog>
  </>;
}
