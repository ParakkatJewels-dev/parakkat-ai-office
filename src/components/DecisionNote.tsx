'use client';
import { useEffect, useRef } from 'react';

const NEEDS_NOTE = new Set(['send_back', 'reject', 'changes']);
const ASK = 'Add a short note so the team knows what to change or why.';

/**
 * The note box in a decision form. What you type is kept in this tab, so a failed save or a reload
 * never wipes it, and Send back, Request changes and Reject are stopped until there is a note.
 */
export function DecisionNote({ storageKey, id, placeholder }: { storageKey: string; id: string; placeholder?: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const key = `pk-note:${storageKey}`;
  useEffect(() => {
    const el = box.current; if (!el) return;
    try { const saved = sessionStorage.getItem(key); if (saved && !el.value) el.value = saved; } catch {}
    const form = el.form;
    // The pressed button decides whether a note is required; the browser's own check then blocks the send.
    const pick = (e: Event) => {
      const button = (e.target as HTMLElement | null)?.closest?.('button[name="decision"]') as HTMLButtonElement | null;
      if (!button) return;
      const needed = NEEDS_NOTE.has(button.value);
      el.required = needed;
      el.setCustomValidity(needed && !el.value.trim() ? ASK : '');
    };
    form?.addEventListener('click', pick, true);
    return () => form?.removeEventListener('click', pick, true);
  }, [key]);
  return <textarea ref={box} id={id} className="in" name="note" rows={3} maxLength={2000} placeholder={placeholder}
    onChange={e => { e.currentTarget.setCustomValidity(''); try { if (e.currentTarget.value.trim()) sessionStorage.setItem(key, e.currentTarget.value); else sessionStorage.removeItem(key); } catch {} }} />;
}
