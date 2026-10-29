'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Keep existing bookmarks useful after the approval queues moved into separate tabs. */
export function ApprovalAnchor() {
  const router=useRouter();
  useEffect(()=>{
    const hash=window.location.hash, params=new URLSearchParams(window.location.search);
    if(params.has('tab') || params.has('campaign') || params.has('report'))return;
    const campaign=hash.match(/^#c-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if(campaign){params.set('campaign',campaign[1]);router.replace(`/approvals?${params}#campaign-${campaign[1]}`,{scroll:false});return;}
    const tab=hash==='#decided'?'decided':/^#(plans|art-|approval-|campaign-)/.test(hash)?'plans':null;
    if(tab){params.set('tab',tab);router.replace(`/approvals?${params}${hash}`,{scroll:false});}
  },[router]);
  return null;
}
