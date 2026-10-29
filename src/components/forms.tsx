'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon, type IconName } from './Icon';

/** A form's submit button: spins and says what is happening while the server works, so it is not pressed twice. */
export function Submit({ children, pending: busy = 'Saving…', icon, ghost, small, className = '', name, value, disabled = false, confirm, confirmTitle = 'Review before continuing', confirmLabel = 'Confirm', danger = false }:
  { children: React.ReactNode; pending?: string; icon?: IconName; ghost?: boolean; small?: boolean; className?: string; name?: string; value?: string; disabled?: boolean; confirm?:string; confirmTitle?:string; confirmLabel?:string; danger?:boolean }) {
  const { pending: sending, data } = useFormStatus();
  const button = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), titleId = useId(), descriptionId = useId();
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (reviewing) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [reviewing]);
  function proceed() {
    const submitter=button.current;
    setReviewing(false);
    if (!submitter?.form || submitter.disabled) return;
    // requestSubmit preserves native validation and the clicked button's name/value.
    submitter.form.requestSubmit(submitter);
  }
  // with several buttons in one form, only the one pressed spins; all of them wait
  const pending = sending && (!name || data?.get(name) === value);
  return (
    <><button ref={button} type="submit" className={`btn ${ghost ? 'ghost' : ''} ${small ? 'sm-btn' : ''} ${pending ? 'busy' : ''} ${danger ? 'danger' : ''} ${className}`} disabled={disabled || sending} aria-busy={pending} name={name} value={value} onClick={event=>{if(confirm){event.preventDefault();if(button.current?.form?.reportValidity())setReviewing(true);}}}>
      {pending ? <span className="spin" aria-hidden="true" /> : icon && <Icon name={icon} size={small ? 16 : 18} />}
      <span aria-live="polite">{pending ? busy : children}</span>
    </button>{confirm&&<dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={()=>setReviewing(false)} onClose={()=>{setReviewing(false);button.current?.focus();}}>
      <div className="confirm-heading"><span className="confirm-icon"><Icon name={danger?'pause':'check'} size={23}/></span><h2 id={titleId}>{confirmTitle}</h2></div>
      <p id={descriptionId}>{confirm}</p>
      <div className="confirm-actions"><button autoFocus type="button" className="btn ghost" onClick={()=>setReviewing(false)}>Cancel</button><button type="button" className={`btn ${danger?'danger':''}`} onClick={proceed} disabled={disabled||sending}>{confirmLabel}</button></div>
    </dialog>}</>
  );
}

/**
 * A form that stays read-only once saved. Edit unlocks it, Cancel puts the saved values back.
 * Give it a key that changes when the saved values change, so it locks again after each save.
 */
export function Locked({ action, saved, children, className = '', inline, label = 'Save', savedNote }:
  { action: (form: FormData) => void | Promise<void>; saved: boolean; children: React.ReactNode; className?: string; inline?: boolean; label?: string; savedNote?: React.ReactNode }) {
  const [editing, setEditing] = useState(!saved), form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className={`${className} locked-form ${editing ? 'editing' : 'is-locked'}`}>
      <fieldset className="lockable" disabled={!editing}>{children}</fieldset>
      <div className={`lock-act ${inline ? 'inline-act' : ''}`}>
        {editing ? <>
          <Submit ghost small icon="check">{label}</Submit>
          {saved && <button type="button" className="btn ghost sm-btn quiet" onClick={() => { form.current?.reset(); setEditing(false); }}>Cancel</button>}
        </> : <>
          {savedNote && !inline && <span className="sm saved-note"><Icon name="lock" size={13} />{savedNote}</span>}
          <button type="button" className="btn ghost sm-btn" onClick={() => setEditing(true)}><Icon name="edit" size={15} />Edit</button>
        </>}
      </div>
    </form>
  );
}

/** A link that leaves for another site (a platform's sign-in page) and shows it is on its way. */
export function GoLink({ href, children, className = 'btn sm-btn', going = 'Opening…' }: { href: string; children: React.ReactNode; className?: string; going?: string }) {
  const [on, setOn] = useState(false);
  return <a href={href} className={`${className} ${on ? 'busy' : ''}`} aria-busy={on} onClick={() => setOn(true)}>{on && <span className="spin" aria-hidden="true" />}{on ? going : children}</a>;
}
