'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Compare live controls with their saved/native defaults without retaining their values. */
export function hasSettingsDraft(root: HTMLElement | null): boolean {
  if (!root) return false;
  return Array.from(root.querySelectorAll('input, textarea, select')).some(control => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
      || !control.name || !control.form || control.form.getAttribute('data-settings-filter') === 'true'
      || !root.contains(control.form) || control.matches(':disabled')) return false;
    if (control instanceof HTMLInputElement) {
      if (['hidden', 'submit', 'reset', 'button', 'image'].includes(control.type)) return false;
      if (control.type === 'checkbox' || control.type === 'radio') return control.checked !== control.defaultChecked;
      if (control.type === 'file') return !!control.files?.length;
      return control.value !== control.defaultValue;
    }
    if (control instanceof HTMLTextAreaElement) return control.value !== control.defaultValue;
    const options = Array.from(control.options), explicitDefault = options.some(option => option.defaultSelected);
    return options.some((option, index) => option.selected !== (explicitDefault ? option.defaultSelected : !control.multiple && index === 0));
  });
}

/** Scope this to the settings content and key it by section when the section changes. */
export function SettingsDraftGuard({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter(), root = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null), titleId = useId(), descriptionId = useId();
  const submission = useRef<{ form: HTMLFormElement; observedBusy: boolean } | null>(null);
  const [leave, setLeave] = useState<{ href: string; pending: boolean } | null>(null);
  const busy = () => !!root.current?.querySelector('form button[aria-busy="true"]');

  useEffect(() => {
    if (leave) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else if (dialog.current?.open) dialog.current.close();
  }, [leave]);

  useEffect(() => {
    const content = root.current;
    if (!content) return;
    const destination = (href: string) => {
      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return null; }
      if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) return null;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
      return `${url.pathname}${url.search}${url.hash}`;
    };
    const request = (href: string) => {
      const pending = busy() || !!submission.current;
      if (!pending && !hasSettingsDraft(content)) return false;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setLeave({ href, pending });
      return true;
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const href = destination(anchor.href);
      if (href && request(href)) { event.preventDefault(); event.stopPropagation(); }
    };
    const navigation = (event: Event) => {
      if (!event.cancelable) return;
      const detail = (event as CustomEvent<{ href?: unknown }>).detail;
      if (typeof detail?.href !== 'string') return;
      const href = destination(detail.href);
      if (href && request(href)) event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // An explicit form submission is allowed to complete its own redirect.
      if (!submission.current && hasSettingsDraft(content)) { event.preventDefault(); event.returnValue = ''; }
    };
    const submit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      if (form.getAttribute('data-settings-filter') === 'true' && form.method.toLowerCase() === 'get') {
        const url = new URL(form.action || window.location.href, window.location.href);
        if (url.origin !== window.location.origin || (form.target && form.target !== '_self')) return;
        const params = new URLSearchParams();
        new FormData(form).forEach((value, name) => { if (typeof value === 'string') params.append(name, value); });
        if (event.submitter instanceof HTMLButtonElement && event.submitter.name) params.append(event.submitter.name, event.submitter.value);
        url.search = params.toString();
        if (request(`${url.pathname}${url.search}${url.hash}`)) { event.preventDefault(); event.stopPropagation(); }
        return;
      }
      if (busy() || submission.current) { event.preventDefault(); event.stopPropagation(); return; }
      submission.current = { form, observedBusy: false };
    };
    const edited = () => { if (!busy()) submission.current = null; };
    const observer = new MutationObserver(records => {
      const pending = busy(), current = submission.current;
      if (current && (pending || records.some(record => record.attributeName === 'aria-busy' && record.oldValue === 'true'))) current.observedBusy = true;
      if (current && (!content.contains(current.form) || (current.observedBusy && !pending))) {
        submission.current = null;
        setLeave(previous => previous?.pending ? null : previous);
      }
    });
    observer.observe(content, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-busy'] });
    document.addEventListener('click', click, true);
    window.addEventListener('workspace:navigate', navigation);
    window.addEventListener('beforeunload', beforeUnload);
    content.addEventListener('submit', submit, true);
    content.addEventListener('input', edited);
    content.addEventListener('change', edited);
    content.addEventListener('reset', edited);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', click, true);
      window.removeEventListener('workspace:navigate', navigation);
      window.removeEventListener('beforeunload', beforeUnload);
      content.removeEventListener('submit', submit, true);
      content.removeEventListener('input', edited);
      content.removeEventListener('change', edited);
      content.removeEventListener('reset', edited);
    };
  }, []);

  return <>
    <div ref={root} className={className}>{children}</div>
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); setLeave(null); }}
      onClose={() => { setLeave(null); returnFocus.current?.focus(); }}>
      <h2 id={titleId}>{leave?.pending ? 'Settings are saving' : 'Keep your changes?'}</h2>
      <p id={descriptionId}>{leave?.pending ? 'Wait for this action to finish before leaving this section.' : 'You have unsaved settings. Keep editing to save them, or discard your changes and continue.'}</p>
      <div className="confirm-actions">
        <button type="button" autoFocus className="btn ghost" onClick={() => setLeave(null)}>{leave?.pending ? 'Stay on this page' : 'Keep editing'}</button>
        {!leave?.pending && <button type="button" className="btn danger" disabled={!leave} onClick={() => {
          if (!leave || busy() || submission.current) return;
          const href = leave.href; setLeave(null); router.push(href);
        }}>Discard and continue</button>}
      </div>
    </dialog>
  </>;
}
