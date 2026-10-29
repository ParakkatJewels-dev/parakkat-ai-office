import test from 'node:test';
import assert from 'node:assert/strict';
import {openIncidentInitiativeIds} from '../src/lib/outcomes/attention.mjs';

test('attention counts distinct visible initiatives with open incidents, preserving historical outcomes separately',()=>{
  const historical=Array.from({length:201},(_,i)=>({id:`old-${i}`,outcome_state:'inconclusive'}));
  const current=Array.from({length:15},(_,i)=>({id:`current-${i}`,outcome_state:'awaiting_data'}));
  const open=current.map(row=>({initiative_id:row.id,status:'open'}));
  const incidents=[...open,...open.slice(0,3),...historical.map(row=>({initiative_id:row.id,status:'resolved'})),{initiative_id:'outside-snapshot',status:'open'},{initiative_id:'old-0',status:'snoozed'},{initiative_id:'old-1',status:'unknown'}];
  const rows=[...historical,...current],affected=openIncidentInitiativeIds(rows,incidents);
  assert.equal(open.length+3,18);assert.equal(affected.size,15);
  assert.deepEqual(rows.filter(row=>affected.has(row.id)).map(row=>row.id),current.map(row=>row.id));
  assert.equal(rows.length,216);assert.equal(incidents.filter(row=>row.status==='resolved').length,201);
  assert.equal(openIncidentInitiativeIds(current.slice(0,4),incidents).size,4,'bounded snapshots cannot count rows their filter cannot display');
  assert.equal(openIncidentInitiativeIds(rows,[]).size,0,'state labels alone do not invent open incidents');
});
