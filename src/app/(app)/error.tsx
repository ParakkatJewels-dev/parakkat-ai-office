'use client';

import { Icon } from '@/components/Icon';

export default function WorkspaceError({reset}:{error:Error & {digest?:string};reset:()=>void}) {
  return <section className="page"><div className="card empty" role="alert" style={{padding:'64px 24px'}}><Icon name="sync" size={32}/><h1 style={{fontSize:26}}>This page couldn’t load</h1><p>Your saved work is still there. Try loading this page again. If it keeps happening, return to the dashboard and check your connections.</p><div className="actions"><a className="btn ghost" href="/dashboard">Back to dashboard</a><button type="button" className="btn" onClick={reset}>Try again</button></div></div></section>;
}
