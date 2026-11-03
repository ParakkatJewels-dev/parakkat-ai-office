import test from 'node:test';
import assert from 'node:assert/strict';
import { odooDayIntent, odooDayForRequest, summarizeOdooDay, readOdooDay } from '../src/lib/agents/odoo-day.mjs';

const observedAt='2026-11-02T11:22:47.660Z';
const cursor={oldest:'2026-07-29',newest:'2026-11-02',pending:[],coverage:'sales orders only; POS module unavailable'};
const rows=[
  {day:'2026-11-02',branch:'PPWH',sku:'SC001',product:'[SC001] Service Charge',units:31,revenue:84932.6},
  {day:'2026-11-02',branch:'PPWH',sku:'PSR0',product:'[PSR0] PKT Stone Ring',units:10,revenue:17835.4},
  {day:'2026-11-02',branch:'HOWH',sku:'PMSB',product:'[PMSB] PM Stone Bangle',units:4,revenue:37030.89},
  {day:'2026-11-02',branch:'PPWH',sku:'PMSB',product:'[PMSB] PM Stone Bangle',units:4,revenue:28329.12},
];

test('daily Odoo questions route to the IST day and preserve the requested source',()=>{
  assert.equal(odooDayIntent('find top selling product, todays and which branch is that'),true);
  assert.equal(odooDayForRequest('today',new Date(observedAt)),'2026-11-02');
  assert.equal(odooDayForRequest('yesterday',new Date(observedAt)),'2026-11-01');
  assert.equal(odooDayIntent('make a product poster'),false);
});

test('rank all Odoo order lines before the row cap, with source and channel limits',()=>{
  const result=summarizeOdooDay(rows,{day:'2026-11-02',observedAt,cursor,syncedAt:'2026-11-02T10:28:14Z',limit:1});
  assert.equal(result.summary.leader.sku,'PSR0');
  assert.deepEqual(result.summary.leader.branches,[{branch:'PPWH',units:10,revenue:17835.4}]);
  assert.equal(result.summary.excluded_charge_skus,1);
  assert.equal(result.sample.truncated,true);
  assert.equal(result.coverage.current_day_partial,true);
  assert.equal(result.coverage.business_wide_rank_supported,false);
  assert.match(result.summary.interpretation,/sales orders only/);
});

test('the reader requires a full bounded day and an unchanged sync cursor',async()=>{
  let cursorReads=0;
  const reader={from:table=>{
    const q={select:(_columns,options)=>{q.countOnly=!!options?.head;return q;},eq:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,maybeSingle:async()=>({data:{state:cursor,updated_at:cursorReads++?'changed':'original'},error:null}),then:(resolve,reject)=>Promise.resolve(q.countOnly?{count:rows.length,error:null}:{data:rows,error:null}).then(resolve,reject)};
    assert.ok(['sync_cursors','odoo_sales_daily'].includes(table));return q;
  }};
  const result=await readOdooDay(reader,new AbortController().signal,'top selling product today',observedAt);
  assert.equal(result.available,false);
  assert.equal(result.state,'sales_changed_during_read');
});

test('requester-scoped reads still report recorded Odoo rows when private sync cursor is hidden',async()=>{
  const reader={from:table=>{
    const q={select:(_columns,options)=>{q.countOnly=!!options?.head;return q;},eq:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,
      maybeSingle:async()=>table==='sync_cursors'?{data:null,error:{message:'not authorized'}}:{data:null,error:{message:'not authorized'}},
      then:(resolve,reject)=>Promise.resolve(q.countOnly?{count:rows.length,error:null}:{data:rows,error:null}).then(resolve,reject)};
    return q;
  }};
  const result=await readOdooDay(reader,new AbortController().signal,'top selling product today',observedAt);
  assert.equal(result.available,true);
  assert.equal(result.summary.leader.sku,'PSR0');
  assert.equal(result.coverage.business_wide_rank_supported,false);
  assert.match(result.coverage.channels,/unknown/);
});
