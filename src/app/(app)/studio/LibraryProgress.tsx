'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import type { LibraryDisplay } from './library-status.mjs';

/** Refresh the queue without presenting a waiting queue as active work. */
export function LibraryProgress({status}:{status:LibraryDisplay}) {
  const router=useRouter();
  useEffect(()=>{
    if(!status.poll)return;
    const timer=setInterval(()=>{if(document.visibilityState==='visible')router.refresh();},status.active?15_000:30_000);
    return()=>clearInterval(timer);
  },[router,status.poll,status.active]);
  return <div className="flash working" role="status">
    {status.active?<span className="spin" aria-hidden="true"/>:<Icon name={status.state==='paused'?'pause':'clock'} size={17}/>}
    <span><b>{status.label}.</b> {status.message}</span>
  </div>;
}
