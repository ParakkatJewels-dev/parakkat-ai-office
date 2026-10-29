'use client';

import { useId } from 'react';
import { pageNumbers, paginationState } from './pagination-core.mjs';

type Props = {
  page:number; total:number; pageSize:number; onPageChange:(page:number)=>void;
  onPageSizeChange?:(size:number)=>void; label?:string;
};

/** Navigation for a loaded, filtered collection. Callers slice using the same clamped page. */
export function Pagination({page,total,pageSize,onPageChange,onPageSizeChange,label='items'}:Props) {
  const id=useId(), state=paginationState(page,total,pageSize);
  const choose=(next:number)=>onPageChange(Math.min(state.pages,Math.max(1,next)));
  return <nav className="pagination" aria-label={`${label} pagination`}>
    <p className="pagination-info" aria-live="polite">{state.total ? <><b>{state.start+1}–{state.end}</b> of <b>{state.total.toLocaleString('en-IN')}</b> {label}</> : `No ${label}`}</p>
    {onPageSizeChange&&<label className="pagination-size" htmlFor={id}>Per page<select id={id} value={state.pageSize} onChange={event=>{onPageSizeChange(Number(event.target.value));onPageChange(1);}}>{[...new Set([10,20,50,state.pageSize])].sort((a,b)=>a-b).map(size=><option key={size} value={size}>{size}</option>)}</select></label>}
    <div className="pagination-controls">
      <button type="button" className="btn ghost sm-btn" onClick={()=>choose(state.page-1)} disabled={state.page===1} aria-label={`Previous page of ${label}`}>Previous</button>
      {pageNumbers(state.page,state.pages).map((number,index)=>number==='ellipsis'?<span key={`gap-${index}`} className="pagination-ellipsis" aria-hidden="true">…</span>:<button type="button" key={number} className={`pagination-page ${number===state.page?'is-current':''}`} aria-label={`Page ${number} of ${label}`} aria-current={number===state.page?'page':undefined} onClick={()=>choose(number)}>{number}</button>)}
      <button type="button" className="btn ghost sm-btn" onClick={()=>choose(state.page+1)} disabled={state.page===state.pages} aria-label={`Next page of ${label}`}>Next</button>
    </div>
  </nav>;
}
